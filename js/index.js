// ============================================
// RENTSPACE - PREMIUM INDEX PAGE
// ============================================

// Dynamic year
document.getElementById('year').textContent = new Date().getFullYear();

// ========== DYNAMIC PATH HELPER ==========
const getBasePath = () => {
    if (window.location.hostname === 'sarahadevelopers.github.io') {
        return '/rentspace-markeplace';
    }
    return '';
};
const basePath = getBasePath();

// API base URL
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

// ========== HERO SLIDER ==========
function initHeroSlider() {
    const slides = document.querySelectorAll('.slide');
    const progressBar = document.getElementById('progressBar');
    if (!slides.length || !progressBar) return;

    let currentSlide = 0;
    const slideDuration = 7000;

    function nextSlide() {
        progressBar.style.transition = 'none';
        progressBar.style.width = '0%';
        slides[currentSlide].classList.remove('active');
        currentSlide = (currentSlide + 1) % slides.length;
        slides[currentSlide].classList.add('active');
        void progressBar.offsetWidth;
        setTimeout(() => {
            progressBar.style.transition = `width ${slideDuration}ms linear`;
            progressBar.style.width = '100%';
        }, 50);
    }

    progressBar.style.transition = `width ${slideDuration}ms linear`;
    progressBar.style.width = '100%';
    setInterval(nextSlide, slideDuration);

    const scrollIndicator = document.querySelector('.scroll-indicator');
    if (scrollIndicator) {
        scrollIndicator.addEventListener('click', () => {
            document.querySelector('.dashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
}

// ========== HAMBURGER MENU ==========
const hamburger = document.getElementById('hamburger');
const navMenu = document.querySelector('.nav-links');
const menuOverlay = document.getElementById('menuOverlay');

function closeMenu() {
    navMenu?.classList.remove('active');
    hamburger?.classList.remove('active');
    menuOverlay?.classList.remove('active');
    document.body.style.overflow = '';
}

function openMenu() {
    navMenu?.classList.add('active');
    hamburger?.classList.add('active');
    menuOverlay?.classList.add('active');
    document.body.style.overflow = 'hidden';
}

hamburger?.addEventListener('click', (e) => {
    e.stopPropagation();
    navMenu?.classList.contains('active') ? closeMenu() : openMenu();
});
menuOverlay?.addEventListener('click', closeMenu);
navMenu?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && navMenu?.classList.contains('active')) closeMenu();
});

// ========== MOBILE DROPDOWNS ==========
function initMobileDropdowns() {
    if (window.innerWidth > 768) return;
    document.querySelectorAll('.dropdown').forEach(dropdown => {
        const trigger = dropdown.querySelector('.dropdown-trigger');
        const menu = dropdown.querySelector('.dropdown-menu');
        if (!trigger || !menu) return;
        const newTrigger = trigger.cloneNode(true);
        trigger.parentNode.replaceChild(newTrigger, trigger);
        newTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropdown.classList.toggle('open');
            menu.classList.toggle('open');
        });
    });
}

// ========== LOAD PROPERTY GRID ==========
async function loadPropertyGrid(containerId, filter = {}, limit = 8) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const params = new URLSearchParams({ status: 'approved', limit: limit, ...filter });
        const response = await fetch(`${API_BASE}/properties?${params}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        let properties = data.properties || [];

        // Shuffle for variety
        properties = shuffleArray(properties);

        if (properties.length === 0) {
            container.innerHTML = `
                <div class="empty-grid-state" style="grid-column:1/-1; text-align:center; padding:40px 0;">
                    <p style="color:var(--text-muted); font-size:15px;">✨ No properties match this criteria.</p>
                    <p style="font-size:13px; margin-top:4px;"><a href="rentals.html" style="color:var(--gold); font-weight:500;">Browse all listings →</a></p>
                </div>
            `;
            return;
        }

        container.innerHTML = properties.map(prop => {
            let badge = '';
            if (prop.featured) badge = 'Featured';
            else if (prop.listingType === 'rent') badge = 'For Rent';
            else if (prop.listingType === 'sale') {
                if (prop.propertyType?.includes('land')) badge = 'Land';
                else badge = 'For Sale';
            } else if (prop.propertyType === 'airbnb') badge = 'Short Stay';

            const formattedPrice = prop.price ? prop.price.toLocaleString() : '0';

            // ===== FIX: Determine correct folder for the property =====
            // Airbnb properties are in /airbnb/, all others in /property/
            let folder = 'property';
            if (prop.propertyType === 'airbnb' || prop.listingType === 'airbnb') {
                folder = 'airbnb';
            }
            // Also check if it's land (though those should be in /property/)
            // This is just a safeguard

            return `
                <a href="${basePath}/${folder}/${prop.slug}.html" class="property-card">
                    <div class="card-image">
                        <img src="${prop.images?.[0] || `${basePath}/images/placeholder.jpg`}" alt="${escapeHtml(prop.title)}" loading="lazy" onerror="this.src='${basePath}/images/placeholder.jpg'">
                        ${badge ? `<span class="card-badge">${badge}</span>` : ''}
                        <span class="card-price">KES ${formattedPrice}</span>
                    </div>
                    <div class="card-body">
                        <div class="card-title">${escapeHtml(prop.title)}</div>
                        <div class="card-location">${escapeHtml(prop.estate || '')}${prop.county ? `, ${escapeHtml(prop.county)}` : ''}</div>
                        <div class="card-specs">
                            ${prop.bedrooms ? `<span><i class="fas fa-bed"></i> ${prop.bedrooms}</span>` : ''}
                            ${prop.bathrooms ? `<span><i class="fas fa-bath"></i> ${prop.bathrooms}</span>` : ''}
                            ${prop.parking ? `<span><i class="fas fa-car"></i> ${prop.parking}</span>` : ''}
                            ${!prop.bedrooms && !prop.bathrooms && !prop.parking ? '<span>View details</span>' : ''}
                        </div>
                    </div>
                </a>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading grid:', error);
        container.innerHTML = `
            <div class="empty-grid-state" style="grid-column:1/-1; text-align:center; padding:40px 0;">
                <p style="color:var(--text-muted);">⚠️ Unable to load properties. Check your connection.</p>
                <p style="font-size:13px; margin-top:4px;"><a href="rentals.html" style="color:var(--gold); font-weight:500;">Browse all listings →</a></p>
            </div>
        `;
    }
}

// ========== HELPERS ==========
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
    hideSplash();
    initHeroSlider();
    initMobileDropdowns();

    // Load the three distinct grids matching the new HTML
    loadPropertyGrid('saleGrid', { listingType: 'sale', limit: 8 });
    loadPropertyGrid('rentGrid', { listingType: 'rent', limit: 8 });
    loadPropertyGrid('landGrid', { listingType: 'sale', propertyType: 'land-res', limit: 6 });
});

// Re-initialize dropdowns on resize
window.addEventListener('resize', initMobileDropdowns);