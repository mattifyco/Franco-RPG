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

// ── Auth ─────────────────────────────────────────────────────────────────────
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
  
  // Remove a senha do objeto antes de enviar
  const userResponse = { id: data.id, role: data.role, name: data.name, email: data.email, avatar: data.avatar };
  
  res.cookie('user', JSON.stringify(userResponse), { 
    maxAge: 7 * 24 * 60 * 60 * 1000, 
    path: '/',
    httpOnly: false,
    secure: false
  });
  
  res.json({ success: true, user: userResponse });
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

// ── Perfil ────────────────────────────────────────────────────────────────────
// GET perfil do usuário por ID
app.get('/api/profile/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, avatar, bio, points, role, rank, position, events_attended, event_role, can_edit_blog')
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Usuário não encontrado' });
  
  // Lógica de Privacidade
  const userCookie = req.cookies.user;
  let isOwnerOrAdmin = false;
  if (userCookie) {
    const loggedInUser = JSON.parse(userCookie);
    if (loggedInUser.id == id || loggedInUser.role === 'admin') {
      isOwnerOrAdmin = true;
    }
  }

  if (!isOwnerOrAdmin) {
    delete data.email;
  }

  res.json(data);
});

// PUT atualizar perfil (nome, bio, avatar)
app.put('/api/profile/:id', upload.single('avatar'), async (req, res) => {
  const { id } = req.params;
  const { name, bio } = req.body;

  const updateData = {};
  if (name) updateData.name = name;
  if (bio !== undefined) updateData.bio = bio;

  // Se enviou nova foto, salva o caminho
  if (req.file) {
    updateData.avatar = `/uploads/${req.file.filename}`;
  }

  const { error } = await supabase
    .from('users')
    .update(updateData)
    .eq('id', id);

  if (error) {
    console.error('Erro ao atualizar perfil:', error);
    return res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }

  res.json({ success: true });
});

// ── Ranking ───────────────────────────────────────────────────────────────────
app.get('/api/ranking', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, points, rank, avatar')
    .order('points', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: 'Erro ao carregar ranking' });
  res.json(data || []);
});

// ── Chat ──────────────────────────────────────────────────────────────────────
// Tabela chat_messages: id, user_id, user_name, user_avatar, content, created_at
// Cria a tabela se não existir via SQL no Supabase; aqui apenas usa via API
app.get('/api/chat', async (req, res) => {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, user_id, user_name, user_avatar, content, created_at')
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    console.error('Erro ao carregar chat:', error);
    return res.json([]);
  }
  res.json(data || []);
});

app.post('/api/chat', async (req, res) => {
  const { user_id, content } = req.body;
  if (!user_id || !content) return res.status(400).json({ error: 'Dados inválidos' });

  // Busca nome e avatar do usuário
  const { data: userData } = await supabase
    .from('users')
    .select('name, avatar')
    .eq('id', user_id)
    .single();

  const { error } = await supabase.from('chat_messages').insert([{
    user_id,
    user_name: userData?.name || 'Aventureiro',
    user_avatar: userData?.avatar || null,
    content
  }]);

  if (error) {
    console.error('Erro ao enviar mensagem:', error);
    return res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
  res.json({ success: true });
});

// ── Mesas ─────────────────────────────────────────────────────────────────────
app.get('/api/tables', async (req, res) => {
  const { data, error } = await supabase.from('tables').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

// GET mesa individual por ID
app.get('/api/tables/:id', async (req, res) => {
  const { data, error } = await supabase.from('tables').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Mesa não encontrada' });
  res.json(data);
});

// POST criar mesa
app.post('/api/tables', async (req, res) => {
  const { title, system, narrator_name, max_players, location, description, image_url } = req.body;
  const { data, error } = await supabase.from('tables').insert([{
    title, system, narrator_name, max_players, location, description, image_url, status: 'open', current_players: 0
  }]).select();
  if (error) return res.status(500).json({ error: 'Erro ao criar mesa' });
  res.json({ success: true, id: data[0].id });
});

// PUT atualizar mesa
app.put('/api/tables/:id', async (req, res) => {
  const { error } = await supabase.from('tables').update(req.body).eq('id', req.params.id);
  res.json({ success: !error });
});

// DELETE deletar mesa
app.delete('/api/tables/:id', async (req, res) => {
  const { error } = await supabase.from('tables').delete().eq('id', req.params.id);
  res.json({ success: !error });
});

// ── Propostas ─────────────────────────────────────────────────────────────────
app.get('/api/admin/proposals', async (req, res) => {
  const { data, error } = await supabase.from('table_proposals').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/proposals/upload', upload.single('cover_image'), async (req, res) => {
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const { data, error } = await supabase.from('table_proposals').insert([{ ...req.body, image_url: imageUrl, status: 'pending' }]).select();
  res.json({ success: !error, id: data ? data[0].id : null });
});

// GET propostas de um usuário específico
app.get('/api/proposals/user/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('table_proposals')
    .select('id, title, status, rejection_reason, created_at')
    .eq('user_id', req.params.userId)
    .order('created_at', { ascending: false });

  if (error) return res.json([]);
  res.json(data || []);
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

// Rejeitar proposta
app.post('/api/admin/proposals/:id/reject', async (req, res) => {
  // O frontend envia 'reason', mas também suportamos 'rejection_reason'
  const rejection_reason = req.body.rejection_reason || req.body.reason || 'Proposta recusada.';
  const { error } = await supabase
    .from('table_proposals')
    .update({ status: 'rejected', rejection_reason })
    .eq('id', req.params.id);
  res.json({ success: !error });
});

// ── Blog ──────────────────────────────────────────────────────────────────────
app.get('/api/blog', async (req, res) => {
  const { data } = await supabase.from('blog_posts').select('*').eq('published', 1).order('published_at', { ascending: false });
  res.json(data || []);
});

// GET post individual (por slug ou ID)
app.get('/api/blog/:identifier', async (req, res) => {
  const { identifier } = req.params;
  let query = supabase.from('blog_posts').select('*');
  
  if (!isNaN(identifier)) {
    query = query.eq('id', identifier);
  } else {
    query = query.eq('slug', identifier);
  }

  const { data, error } = await query.single();
  if (error || !data) return res.status(404).json({ error: 'Post não encontrado' });
  res.json(data);
});

// GET todos os posts (admin)
app.get('/api/admin/blog-all', async (req, res) => {
  const { data, error } = await supabase.from('blog_posts').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Erro ao carregar posts' });
  res.json(data || []);
});

// POST criar post
app.post('/api/blog', async (req, res) => {
  const { title, slug, excerpt, content, cover_image, category, author_id, published } = req.body;
  const { data, error } = await supabase.from('blog_posts').insert([{
    title, slug, excerpt, content, cover_image, category, author_id,
    published: published ? 1 : 0,
    published_at: published ? new Date().toISOString() : null
  }]).select();
  if (error) return res.status(500).json({ error: 'Erro ao criar post: ' + error.message });
  res.json({ success: true, id: data[0].id });
});

// PUT atualizar post
app.put('/api/blog/:id', async (req, res) => {
  const { title, slug, excerpt, content, cover_image, category, published } = req.body;
  const updateData = { title, slug, excerpt, content, cover_image, category, published: published ? 1 : 0, updated_at: new Date().toISOString() };
  if (published) updateData.published_at = new Date().toISOString();
  const { error } = await supabase.from('blog_posts').update(updateData).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Erro ao atualizar post' });
  res.json({ success: true });
});

// DELETE deletar post
app.delete('/api/blog/:id', async (req, res) => {
  const { error } = await supabase.from('blog_posts').delete().eq('id', req.params.id);
  res.json({ success: !error });
});

// ── Usuários (Admin) ──────────────────────────────────────────────────────────
app.get('/api/admin/users', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, points, rank, position, role, can_edit_blog, created_at')
    .order('points', { ascending: false });

  if (error) return res.status(500).json({ error: 'Erro ao carregar usuários' });
  res.json(data || []);
});

// GET usuário individual (admin)
app.get('/api/admin/users/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, avatar, bio, points, role, rank, position, events_attended, event_role, can_edit_blog')
    .eq('id', req.params.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(data);
});

// PUT atualizar usuário (admin) - aceita FormData com avatar opcional
app.put('/api/admin/users/:id', upload.single('avatar'), async (req, res) => {
  const { name, email, bio, points, rank, position, role, event_role, can_edit_blog, events_attended } = req.body;
  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (email !== undefined) updateData.email = email;
  if (bio !== undefined) updateData.bio = bio;
  if (points !== undefined) updateData.points = parseInt(points) || 0;
  if (rank !== undefined) updateData.rank = rank;
  if (position !== undefined) updateData.position = position;
  if (role !== undefined) updateData.role = role;
  if (event_role !== undefined) updateData.event_role = event_role;
  if (can_edit_blog !== undefined) updateData.can_edit_blog = can_edit_blog == 1 || can_edit_blog === 'true' || can_edit_blog === true;
  if (events_attended !== undefined) updateData.events_attended = parseInt(events_attended) || 0;
  if (req.file) updateData.avatar = `/uploads/${req.file.filename}`;

  const { error } = await supabase.from('users').update(updateData).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Erro ao atualizar usuário' });
  res.json({ success: true });
});

// DELETE deletar usuário (admin)
app.delete('/api/admin/users/:id', async (req, res) => {
  const { id } = req.params;
  
  // Opcional: Impedir que um admin delete a si mesmo
  const userCookie = req.cookies.user;
  if (userCookie) {
    const loggedInUser = JSON.parse(userCookie);
    if (loggedInUser.id == id) {
      return res.status(400).json({ error: 'Você não pode deletar sua própria conta!' });
    }
  }

  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) {
    console.error('Erro ao deletar usuário:', error);
    return res.status(500).json({ error: 'Erro ao deletar usuário' });
  }
  res.json({ success: true });
});

// ── Heróis ────────────────────────────────────────────────────────────────────
app.get('/api/heroes', async (req, res) => {
  // Removi o filtro de 'active' e 'order' para garantir que os heróis apareçam
  const { data, error } = await supabase.from('heroes').select('*').order('name', { ascending: true });
  if (error) return res.status(500).json({ error: 'Erro ao carregar heróis' });
  res.json(data || []);
});

app.get('/api/heroes/:id', async (req, res) => {
  const { data, error } = await supabase.from('heroes').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Herói não encontrado' });
  res.json(data);
});

app.post('/api/heroes', upload.single('avatar'), async (req, res) => {
  const avatarUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const { name, role, handle, bio, years_playing, years_narrating, highlights } = req.body;
  const { data, error } = await supabase.from('heroes').insert([{
    name, role, handle, bio, years_playing, years_narrating, highlights,
    avatar_url: avatarUrl, active: 1
  }]).select();
  if (error) return res.status(500).json({ error: 'Erro ao criar herói' });
  res.json({ success: true, id: data[0].id });
});

app.put('/api/heroes/:id', upload.single('avatar'), async (req, res) => {
  const { name, role, handle, bio, years_playing, years_narrating, highlights } = req.body;
  const updateData = { name, role, handle, bio, years_playing, years_narrating, highlights };
  if (req.file) updateData.avatar_url = `/uploads/${req.file.filename}`;

  const { error } = await supabase.from('heroes').update(updateData).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Erro ao atualizar herói' });
  res.json({ success: true });
});

app.delete('/api/heroes/:id', async (req, res) => {
  // Agora deleta de verdade em vez de apenas desativar
  const { error } = await supabase.from('heroes').delete().eq('id', req.params.id);
  res.json({ success: !error });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { count: tables } = await supabase.from('tables').select('*', { count: 'exact', head: true });
  const { count: posts } = await supabase.from('blog_posts').select('*', { count: 'exact', head: true });
  const { count: heroes } = await supabase.from('heroes').select('*', { count: 'exact', head: true });
  const { count: proposals } = await supabase.from('table_proposals').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  res.json({
    total_users: users || 0,
    total_tables: tables || 0,
    total_posts: posts || 0,
    total_heroes: heroes || 0,
    pending_proposals: proposals || 0
  });
});

// ── Upload genérico ───────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), (req, res) => {
  res.json({ url: req.file ? `/uploads/${req.file.filename}` : null });
});

// ─── SPA / HTML Routing ──────────────────────────────────────────────────────
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
