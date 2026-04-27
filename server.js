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
const PORT = process.env.PORT || 10000;

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://nvflpadchqhozrmfvcyp.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_hiBX0DdVbQ77_R-i7K9Vog_2gMq8kP0';
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(cookieParser());

// Busca a pasta public de forma ultra-robusta
const publicPath = join(__dirname, 'public');
console.log('Servidor iniciado. Diretorio:', __dirname);
console.log('Tentando usar pasta public em:', publicPath);

if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));
} else {
    console.error('AVISO: Pasta public nao encontrada em ' + publicPath);
}

// Upload folder setup
const uploadsDir = join(publicPath, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Helpers
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// ─── API Routes ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  const hashedPassword = hashPassword(password);
  const { data, error } = await supabase.from('users').insert([{ name, email, password: hashedPassword }]).select();
  if (error) return res.status(400).json({ error: 'Email ja cadastrado' });
  res.json({ success: true, userId: data[0].id });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('--- TENTATIVA DE LOGIN ---');
  console.log('Email:', email);
  
  const hashedPassword = hashPassword(password);
  console.log('Hash gerado para a senha enviada:', hashedPassword);

  const { data, error } = await supabase.from('users')
    .select('id, role, name, email, password')
    .eq('email', email)
    .single();

  if (error || !data) {
    console.error('ERRO: Usuario nao encontrado no Supabase:', email);
    return res.status(401).json({ error: 'Email ou senha invalidos' });
  }

  console.log('Usuario encontrado. Hash no banco:', data.password);

  if (data.password !== hashedPassword) {
    console.error('ERRO: A senha nao confere!');
    return res.status(401).json({ error: 'Email ou senha invalidos' });
  }

  console.log('LOGIN SUCESSO:', data.name);
  
  // Remove a senha do objeto antes de enviar para o cookie
  const userResponse = { id: data.id, role: data.role, name: data.name, email: data.email };
  res.cookie('user', JSON.stringify(userResponse), { 
    maxAge: 7 * 24 * 60 * 60 * 1000, 
    httpOnly: false,
    secure: true,
    sameSite: 'none'
  });
  res.json({ success: true, user: userResponse });
});

app.get('/api/auth/me', (req, res) => {
  const userCookie = req.cookies.user;
  if (!userCookie) return res.status(401).json({ error: 'Nao autenticado' });
  res.json(JSON.parse(userCookie));
});

app.get('/api/tables', async (req, res) => {
  const { data, error } = await supabase.from('tables').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

app.put('/api/tables/:id', async (req, res) => {
  const { error } = await supabase.from('tables').update(req.body).eq('id', req.params.id);
  res.json({ success: !error });
});

app.get('/api/admin/proposals', async (req, res) => {
  const { data, error } = await supabase.from('table_proposals').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/proposals/upload', upload.single('cover_image'), async (req, res) => {
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const { data, error } = await supabase.from('table_proposals').insert([{ ...req.body, image_url: imageUrl, status: 'pending' }]).select();
  res.json({ success: !error, id: data ? data[0].id : null });
});

app.post('/api/admin/proposals/:id/accept', async (req, res) => {
  const { data: proposal } = await supabase.from('table_proposals').select('*').eq('id', req.params.id).single();
  if (!proposal) return res.status(404).json({ error: 'Proposta nao encontrada' });
  await supabase.from('tables').insert([{
    title: proposal.title, description: proposal.description, system: proposal.system,
    narrator_name: proposal.narrator_name, narrator_phone: proposal.narrator_phone,
    max_players: proposal.max_players, location: proposal.location,
    image_url: proposal.image_url, signup_url: proposal.signup_url, status: 'open'
  }]);
  await supabase.from('table_proposals').update({ status: 'accepted' }).eq('id', req.params.id);
  res.json({ success: true });
});

app.get('/api/blog', async (req, res) => {
  const { data } = await supabase.from('blog_posts').select('*').eq('published', 1).order('published_at', { ascending: false });
  res.json(data || []);
});

app.get('/api/stats', async (req, res) => {
  const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { count: tables } = await supabase.from('tables').select('*', { count: 'exact', head: true });
  const { count: posts } = await supabase.from('blog_posts').select('*', { count: 'exact', head: true });
  const { count: heroes } = await supabase.from('heroes').select('*', { count: 'exact', head: true });
  res.json({ total_users: users || 0, total_tables: tables || 0, total_posts: posts || 0, total_heroes: heroes || 0 });
});

app.get('/api/heroes', async (req, res) => {
  const { data } = await supabase.from('heroes').select('*').eq('active', 1).order('order');
  res.json(data || []);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  res.json({ url: req.file ? `/uploads/${req.file.filename}` : null });
});

// ─── SPA / HTML Routing ──────────────────────────────────────────────────────
// Serve arquivos HTML especificos sem precisar da extensao .html na URL
app.get('/mesas', (req, res) => res.sendFile(join(publicPath, 'mesas.html')));
app.get('/herois', (req, res) => res.sendFile(join(publicPath, 'herois.html')));
app.get('/blog', (req, res) => res.sendFile(join(publicPath, 'blog.html')));
app.get('/admin', (req, res) => res.sendFile(join(publicPath, 'admin.html')));
app.get('/perfil', (req, res) => res.sendFile(join(publicPath, 'perfil.html')));
app.get('/blog-editor', (req, res) => res.sendFile(join(publicPath, 'blog-editor.html')));

// Rota padrao (Home)
app.get('/', (req, res) => res.sendFile(join(publicPath, 'index.html')));

// Curinga para SPA
app.get('*', (req, res) => {
    const file = join(publicPath, 'index.html');
    if (fs.existsSync(file)) res.sendFile(file);
    else res.status(404).send('Site em manutencao. Pasta public nao encontrada.');
});

app.listen(PORT, () => console.log(`Servidor Franco RPG rodando na porta ${PORT}`));
