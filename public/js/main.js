// ─── DOM Elements ──────────────────────────────────────────────────────────────
const loginModal = document.getElementById('loginModal');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const mobileMenu = document.getElementById('mobileMenu');

// ─── Auth State ────────────────────────────────────────────────────────────────
let currentUser = null;

// Check if user is logged in on page load
function checkAuth() {
  const user = localStorage.getItem('user');
  if (user) {
    currentUser = JSON.parse(user);
    updateNavAuth();
  }
}

function updateNavAuth() {
  const navAuth = document.querySelector('.nav-auth');
  if (!navAuth) return;

  if (currentUser) {
    navAuth.innerHTML = `
      <div class="user-menu">
        <span class="user-name">${currentUser.name}</span>
        <button class="btn-profile" onclick="goToProfile()">Perfil</button>
        ${currentUser.role === 'admin' ? '<button class="btn-admin" onclick="goToAdmin()">Admin</button>' : ''}
        <button class="btn-logout" onclick="logout()">Sair</button>
      </div>
    `;
  } else {
    navAuth.innerHTML = `
      <button class="btn-login" onclick="openLoginModal()">Entrar</button>
      <button class="btn-menu" onclick="toggleMobileMenu()">☰</button>
    `;
  }
}

// ─── Modal Functions ───────────────────────────────────────────────────────────
function openLoginModal() {
  loginModal.classList.add('active');
  switchTab('login');
}

function closeLoginModal() {
  loginModal.classList.remove('active');
}

function switchTab(tab) {
  const tabs = document.querySelectorAll('.tab-btn');
  const forms = document.querySelectorAll('.modal-form');

  tabs.forEach(t => t.classList.remove('active'));
  forms.forEach(f => f.classList.remove('active-form'));

  if (tab === 'login') {
    tabs[0].classList.add('active');
    loginForm.classList.add('active-form');
  } else {
    tabs[1].classList.add('active');
    registerForm.classList.add('active-form');
  }
}

function toggleMobileMenu() {
  mobileMenu.classList.toggle('active');
}

// Close modal on click outside
if (loginModal) {
  loginModal.addEventListener('click', (e) => {
    if (e.target === loginModal) closeLoginModal();
  });
}

// ─── Login Handler ─────────────────────────────────────────────────────────────
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginForm.querySelector('input[type="email"]').value;
    const password = loginForm.querySelector('input[type="password"]').value;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        // Get user profile
        const profileResponse = await fetch(`/api/profile/${data.userId}`);
        const profile = await profileResponse.json();
        
        currentUser = { ...profile, userId: data.userId, role: data.role };
        localStorage.setItem('user', JSON.stringify(currentUser));
        
        closeLoginModal();
        updateNavAuth();
        alert('Login realizado com sucesso!');
        
        // Redirect to profile after login
        setTimeout(() => window.location.href = '/perfil', 500);
      } else {
        alert(data.error || 'Erro ao fazer login');
      }
    } catch (error) {
      console.error('Erro:', error);
      alert('Erro ao fazer login');
    }

    loginForm.reset();
  });
}

// ─── Register Handler ──────────────────────────────────────────────────────────
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = registerForm.querySelector('input[type="text"]').value;
    const email = registerForm.querySelectorAll('input[type="email"]')[0].value;
    const password = registerForm.querySelectorAll('input[type="password"]')[0].value;
    const confirmPassword = registerForm.querySelectorAll('input[type="password"]')[1].value;

    if (password !== confirmPassword) {
      alert('As senhas não conferem!');
      return;
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });

      const data = await response.json();

      if (response.ok) {
        alert('Cadastro realizado com sucesso! Faça login para continuar.');
        switchTab('login');
        registerForm.reset();
      } else {
        alert(data.error || 'Erro ao cadastrar');
      }
    } catch (error) {
      console.error('Erro:', error);
      alert('Erro ao cadastrar');
    }
  });
}

// ─── Navigation Functions ──────────────────────────────────────────────────────
function goToProfile() {
  window.location.href = '/perfil';
}

function goToAdmin() {
  window.location.href = '/admin';
}

function logout() {
  fetch('/api/auth/logout', { method: 'POST' });
  localStorage.removeItem('user');
  currentUser = null;
  updateNavAuth();
  window.location.href = '/';
}

// ─── Load Featured Tables ──────────────────────────────────────────────────────
async function loadFeaturedTables() {
  try {
    const response = await fetch('/api/tables');
    const tables = await response.json();
    const featured = tables.slice(0, 3);
    const container = document.getElementById('featuredTables');

    if (featured.length === 0) {
      container.innerHTML = '<p class="loading">Nenhuma mesa disponível no momento</p>';
      return;
    }

    container.innerHTML = featured.map(table => `
      <div class="table-card" onclick="location.href='/mesas#table-${table.id}'">
        <div class="table-header">
          <h3 class="table-title">${table.title}</h3>
          <span class="table-system">${table.system}</span>
        </div>
        <div class="table-body">
          <div class="table-info">
            <span>🎭 ${table.narrator_name || 'Narrador TBD'}</span>
            <span class="table-status ${table.status}">${table.status === 'open' ? 'Aberta' : 'Lotada'}</span>
          </div>
          <p class="table-description">${table.description || 'Uma aventura épica aguarda você...'}</p>
          <div class="table-footer">
            <span class="table-players">👥 ${table.current_players}/${table.max_players}</span>
            <span style="color: var(--color-gold); font-weight: 600;">Ver Detalhes →</span>
          </div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Erro ao carregar mesas:', error);
    document.getElementById('featuredTables').innerHTML = '<p class="loading">Erro ao carregar mesas</p>';
  }
}

// ─── Load Featured Blog Posts ───────────────────────────────────────────────────
async function loadFeaturedBlog() {
  try {
    const response = await fetch('/api/blog');
    const posts = await response.json();
    const featured = posts.slice(0, 3);
    const container = document.getElementById('featuredBlog');

    if (featured.length === 0) {
      container.innerHTML = '<p class="loading">Nenhuma postagem disponível no momento</p>';
      return;
    }

    container.innerHTML = featured.map(post => `
      <div class="blog-card" onclick="location.href='/blog#post-${post.slug}'">
        <div class="blog-image">📖</div>
        <div class="blog-content">
          <span class="blog-category">${post.category || 'Geral'}</span>
          <h3 class="blog-title">${post.title}</h3>
          <p class="blog-excerpt">${post.excerpt || post.content.substring(0, 100)}...</p>
          <div class="blog-meta">
            <span class="blog-author">${post.author_name || 'Anônimo'}</span>
            <span>${new Date(post.published_at).toLocaleDateString('pt-BR')}</span>
          </div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Erro ao carregar blog:', error);
    document.getElementById('featuredBlog').innerHTML = '<p class="loading">Erro ao carregar postagens</p>';
  }
}

// ─── Load Site Stats ────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    const stats = await response.json();

    const animateCounter = (element, target) => {
      let current = 0;
      const increment = Math.ceil(target / 50);
      const interval = setInterval(() => {
        current += increment;
        if (current >= target) {
          current = target;
          clearInterval(interval);
        }
        element.textContent = current;
      }, 30);
    };

    if (document.getElementById('stat-users')) {
      animateCounter(document.getElementById('stat-users'), stats.total_users || 0);
      animateCounter(document.getElementById('stat-tables'), stats.total_tables || 0);
      animateCounter(document.getElementById('stat-posts'), stats.total_posts || 0);
      animateCounter(document.getElementById('stat-heroes'), stats.total_heroes || 0);
    }
  } catch (error) {
    console.error('Erro ao carregar stats:', error);
  }
}

// ─── Update Active Nav Link ─────────────────────────────────────────────────────
function updateActiveNav() {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === path || (href === '/' && path === '/')) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

// ─── Initialize ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  updateActiveNav();
  loadFeaturedTables();
  loadFeaturedBlog();
  loadStats();
});

// Close mobile menu on link click
document.querySelectorAll('.mobile-link').forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.classList.remove('active');
  });
});

// ─── Smooth scroll for anchor links ─────────────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});
