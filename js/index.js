// ============================================
// RENTSPACE - PREMIUM INDEX PAGE
// ============================================

// Dynamic year
document.getElementById('year').textContent = new Date().getFullYear();

// ========== DYNAMIC PATH HELPER ==========
const getBasePath = () => {
    // GitHub Pages
    if (window.location.hostname === 'sarahadevelopers.github.io') {
        return '/rentspace-markeplace';   // ✅ corrected
    }
    // Local development
    return '';
};
const basePath = getBasePath();

// API base URL – your live backend on Render
const API_BASE = 'https://rentspace-markeplace.onrender.com/api';

// ========== SPLASH SCREEN ==========
function hideSplash() {
  setTimeout(() => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => {
        splash.style.display = 'none';
      }, 800);
    }
  }, 2200);
}

// ========== DYNAMIC GREETING ==========
function updateGreeting() {
  const hour = new Date().getHours();
  // Optional: update a greeting element if you add one
}

// ========== PREMIUM HERO SLIDER ==========
function initHeroSlider() {
  const slides = document.querySelectorAll('.slide');
  const progressBar = document.getElementById('progressBar');
  
  if (!slides.length || !progressBar) return;
  
  let currentSlide = 0;
  const slideDuration = 7000; // 7 seconds per slide
  
  function nextSlide() {
    // Reset progress bar
    progressBar.style.transition = 'none';
    progressBar.style.width = '0%';
    
    // Switch slides
    slides[currentSlide].classList.remove('active');
    currentSlide = (currentSlide + 1) % slides.length;
    slides[currentSlide].classList.add('active');
    
    // Force reflow to ensure transition restarts
    void progressBar.offsetWidth;
    
    // Start progress bar animation
    setTimeout(() => {
      progressBar.style.transition = `width ${slideDuration}ms linear`;
      progressBar.style.width = '100%';
    }, 50);
  }
  
  // Start the progress bar
  progressBar.style.transition = `width ${slideDuration}ms linear`;
  progressBar.style.width = '100%';
  
  // Set interval for slide switching
  setInterval(nextSlide, slideDuration);
  
  // Smooth scroll for scroll indicator
  const scrollIndicator = document.querySelector('.scroll-indicator');
  if (scrollIndicator) {
    scrollIndicator.addEventListener('click', () => {
      const dashboard = document.querySelector('.dashboard');
      if (dashboard) {
        dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
}

// ========== HAMBURGER MENU WITH OVERLAY ==========
const hamburger = document.getElementById('hamburger');
const navMenu = document.querySelector('.nav-links');
const menuOverlay = document.getElementById('menuOverlay');

function closeMenu() {
  if (navMenu) navMenu.classList.remove('active');
  if (hamburger) hamburger.classList.remove('active');
  if (menuOverlay) menuOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

function openMenu() {
  if (navMenu) navMenu.classList.add('active');
  if (hamburger) hamburger.classList.add('active');
  if (menuOverlay) menuOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

if (hamburger) {
  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (navMenu && navMenu.classList.contains('active')) {
      closeMenu();
    } else {
      openMenu();
    }
  });
}

if (menuOverlay) {
  menuOverlay.addEventListener('click', closeMenu);
}

// Close menu when clicking a link
if (navMenu) {
  const navLinks = navMenu.querySelectorAll('a');
  navLinks.forEach(link => {
    link.addEventListener('click', closeMenu);
  });
}

// Close menu on window resize
window.addEventListener('resize', () => {
  if (window.innerWidth > 768 && navMenu && navMenu.classList.contains('active')) {
    closeMenu();
  }
});

// ========== MOBILE DROPDOWNS (ONLY ON MOBILE) ==========
function initMobileDropdowns() {
  if (window.innerWidth > 768) return;
  
  const dropdowns = document.querySelectorAll('.dropdown');
  dropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector('.dropdown-trigger');
    const menu = dropdown.querySelector('.dropdown-menu');
    if (trigger && menu) {
      const newTrigger = trigger.cloneNode(true);
      trigger.parentNode.replaceChild(newTrigger, trigger);
      
      newTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropdown.classList.toggle('open');
        menu.classList.toggle('open');
      });
    }
  });
}

// ========== LOAD FEATURED PROPERTIES FROM RENDER API ==========
async function loadFeaturedProperties() {
  try {
    // Fetch properties from API, filter for featured ones
    const response = await fetch(`${API_BASE}/properties?featured=true&limit=4`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const featured = data.properties || [];
    
    const featuredScroll = document.getElementById('featuredScroll');
    if (featuredScroll) {
      if (featured.length === 0) {
        featuredScroll.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Featured properties coming soon.</p>';
        return;
      }
      
      featuredScroll.innerHTML = featured.map(prop => `
        <a href="${basePath}/property/${prop.slug}.html" class="featured-card">
          <img src="${prop.images?.[0] || `${basePath}/images/placeholder.jpg`}" alt="${prop.title}">
          <div class="featured-info">
            <h4>${escapeHtml(prop.title)}</h4>
            <p>${prop.estate} · KES ${prop.price.toLocaleString()}/mo</p>
          </div>
        </a>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading featured properties:', error);
    const featuredScroll = document.getElementById('featuredScroll');
    if (featuredScroll) {
      featuredScroll.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Unable to load featured properties.</p>';
    }
  }
}

// Helper: escape HTML to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ========== INITIALIZE EVERYTHING ==========
document.addEventListener('DOMContentLoaded', () => {
  updateGreeting();
  loadFeaturedProperties();
  hideSplash();
  initMobileDropdowns();
  initHeroSlider();
});

// Re-initialize dropdowns on resize
window.addEventListener('resize', initMobileDropdowns);