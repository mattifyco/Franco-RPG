import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://nvflpadchqhozrmfvcyp.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_hiBX0DdVbQ77_R-i7K9Vog_2gMq8kP0';
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(cookieParser());
// Busca a pasta public de forma robusta
let publicPath = join(__dirname, 'public');
if (!fs.existsSync(publicPath)) {
  publicPath = join(__dirname, '..', 'public'); // Tenta um nível acima se necessário
}
console.log('--- DIAGNOSTICO DE PASTAS ---');
console.log('Diretorio atual (__dirname):', __dirname);
console.log('Caminho public resolvido:', publicPath);
console.log('Conteudo da raiz:', fs.readdirSync(__dirname));
if (fs.existsSync(publicPath)) {
  console.log('Conteudo da pasta public:', fs.readdirSync(publicPath));
} else {
  console.error('ERRO CRITICO: Pasta public nao encontrada!');
}
console.log('---------------------------');

app.use(express.static(publicPath));

// Upload folder setup
const uploadsDir = join(publicPath, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Helpers
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// ─── Routes - Auth ─────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Campos obrigatorios' });
  
  const hashedPassword = hashPassword(password);
  const { data, error } = await supabase.from('users').insert([{ name, email, password: hashedPassword }]).select();
  
  if (error) return res.status(400).json({ error: 'Email ja cadastrado' });
  res.json({ success: true, userId: data[0].id });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const hashedPassword = hashPassword(password);
  
  const { data, error } = await supabase.from('users')
    .select('id, role, name, email')
    .eq('email', email)
    .eq('password', hashedPassword)
    .single();
    
  if (error || !data) return res.status(401).json({ error: 'Email ou senha invalidos' });
  
  res.cookie('user', JSON.stringify(data), { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false });
  res.json({ success: true, user: data });
});

app.get('/api/auth/me', (req, res) => {
  const userCookie = req.cookies.user;
  if (!userCookie) return res.status(401).json({ error: 'Nao autenticado' });
  res.json(JSON.parse(userCookie));
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('user');
  res.json({ success: true });
});

// ─── Routes - Tables ───────────────────────────────────────────────────────────
app.get('/api/tables', async (req, res) => {
  const { data, error } = await supabase.from('tables').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/tables', async (req, res) => {
  const { data, error } = await supabase.from('tables').insert([req.body]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.put('/api/tables/:id', async (req, res) => {
  const { error } = await supabase.from('tables').update(req.body).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.delete('/api/tables/:id', async (req, res) => {
  const { error } = await supabase.from('tables').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─── Routes - Proposals ───────────────────────────────────────────────────────
app.get('/api/admin/proposals', async (req, res) => {
  const { data, error } = await supabase.from('table_proposals').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/proposals/upload', upload.single('cover_image'), async (req, res) => {
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const proposalData = { ...req.body, image_url: imageUrl, status: 'pending' };
  
  const { data, error } = await supabase.from('table_proposals').insert([proposalData]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, id: data[0].id });
});

app.post('/api/admin/proposals/:id/accept', async (req, res) => {
  const { data: proposal, error: fetchErr } = await supabase.from('table_proposals').select('*').eq('id', req.params.id).single();
  if (fetchErr || !proposal) return res.status(404).json({ error: 'Proposta nao encontrada' });

  const tableData = {
    title: proposal.title,
    description: proposal.description,
    system: proposal.system,
    narrator_name: proposal.narrator_name,
    narrator_phone: proposal.narrator_phone,
    max_players: proposal.max_players,
    location: proposal.location,
    image_url: proposal.image_url,
    signup_url: proposal.signup_url,
    status: 'open'
  };

  const { error: insertErr } = await supabase.from('tables').insert([tableData]);
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  await supabase.from('table_proposals').update({ status: 'accepted' }).eq('id', req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/proposals/:id/reject', async (req, res) => {
  const { error } = await supabase.from('table_proposals').update({ status: 'rejected', rejection_reason: req.body.reason }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─── Routes - Blog ────────────────────────────────────────────────────────────
app.get('/api/blog', async (req, res) => {
  const { data, error } = await supabase.from('blog_posts').select('*').eq('published', 1).order('published_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/blog/:slug', async (req, res) => {
  const { data, error } = await supabase.from('blog_posts').select('*').eq('slug', req.params.slug).single();
  if (error) return res.status(404).json({ error: 'Post nao encontrado' });
  res.json(data);
});

// ─── Routes - Stats ───────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { count: tables } = await supabase.from('tables').select('*', { count: 'exact', head: true });
  const { count: posts } = await supabase.from('blog_posts').select('*', { count: 'exact', head: true });
  const { count: heroes } = await supabase.from('heroes').select('*', { count: 'exact', head: true });
  const { count: pending } = await supabase.from('table_proposals').select('*', { count: 'exact', head: true }).eq('status', 'pending');

  res.json({
    total_users: users || 0,
    total_tables: tables || 0,
    total_posts: posts || 0,
    total_heroes: heroes || 0,
    pending_proposals: pending || 0
  });
});

// ─── Routes - Heroes ──────────────────────────────────────────────────────────
app.get('/api/heroes', async (req, res) => {
  const { data, error } = await supabase.from('heroes').select('*').eq('active', 1).order('order');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── Routes - Misc ────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// SPA routing
app.get('*', (req, res) => {
  const indexPath = join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Arquivo index.html nao encontrado no servidor');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor Franco RPG rodando na porta ${PORT}`);
});
