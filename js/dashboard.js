// =============================================
// dashboard.js – RentSpace full version
// =============================================
// This file handles:
// - JWT authentication (token from localStorage)
// - CRUD operations for properties (only for the logged-in user)
// - Image upload with preview (Cloudinary via backend)
// - Features/amenities management
// - Pagination, image modal, toasts
// - Dynamic price labels for Sale/Rent/Airbnb
// - Subscription management (plans, upgrade, STK push)
// - Auto-retry property creation after subscription
// =============================================

// =========================
// Global State
// =========================
let currentEditId = null;
let existingImages = [];
let existingPublicIds = [];
let allProperties = [];
let features = [];
let selectedImages = [];
let pendingFormData = null;           // 🆕 Store form data for retry

// =========================
// API Configuration
// =========================
const API_BASE = 'https://rentspace-markeplace.onrender.com';

// =========================
// Utility Functions
// =========================
const Utils = {
    formatFileSize: (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    showToast: (message, type = 'success') => {
        let toast = document.getElementById('rentspaceToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'rentspaceToast';
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                padding: 12px 24px;
                border-radius: 8px;
                color: white;
                font-weight: 500;
                z-index: 10000;
                animation: slideIn 0.3s ease;
                transition: opacity 0.3s ease;
            `;
            document.body.appendChild(toast);
            if (!document.querySelector('#toastStyles')) {
                const style = document.createElement('style');
                style.id = 'toastStyles';
                style.textContent = `
                    @keyframes slideIn {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                `;
                document.head.appendChild(style);
            }
        }
        toast.style.backgroundColor = type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8';
        toast.textContent = message;
        toast.style.opacity = '1';
        clearTimeout(toast._hideTimeout);
        toast._hideTimeout = setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
        }, 3000);
    },

    formatPrice: (priceNum) => {
        if (!priceNum || priceNum === 0) return 'Price on request';
        if (priceNum >= 1000000) {
            const millions = priceNum / 1000000;
            return `KES ${millions.toFixed(1)}M`.replace('.0M', 'M');
        } else if (priceNum >= 1000) {
            return `KES ${(priceNum / 1000).toFixed(0)}K`;
        }
        return `KES ${priceNum.toLocaleString('en-KE')}`;
    },

    delay: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// =========================
// Authentication Helpers
// =========================
const getToken = () => localStorage.getItem('rentspace_token');
const redirectToLogin = () => {
    window.location.href = 'login.html';
};

const authFetch = async (url, options = {}) => {
    const token = getToken();
    if (!token) {
        redirectToLogin();
        throw new Error('No token');
    }
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...(options.headers || {})
        }
    });
    if (res.status === 401) {
        localStorage.removeItem('rentspace_token');
        redirectToLogin();
        throw new Error('Unauthorized');
    }
    return res;
};

// =========================
// DOM Elements
// =========================
const propertyForm = document.getElementById('propertyForm');
const propertiesTable = document.querySelector('#propertiesTable tbody');
const logoutBtn = document.getElementById('logoutBtn');
const imageInput = document.getElementById('images');
const imagePreview = document.getElementById('imagePreview');
const existingPreview = document.getElementById('existingImagesPreview');
const formStatus = document.getElementById('formStatus');
const formTitle = document.getElementById('formTitle');
const submitBtn = document.getElementById('submitBtn');
const resetBtn = document.getElementById('resetForm');
const propertyCountDisplay = document.getElementById('propertyCountDisplay');
const paginationControls = document.getElementById('paginationControls');

// =========================
// Dynamic Price Label / Hint
// =========================
function updatePriceField() {
    const listingType = document.getElementById('listingType')?.value || 'sale';
    const isAirbnb = document.getElementById('isAirbnb')?.value === 'true';
    const propertyType = document.getElementById('propertyType')?.value || '';
    const priceLabel = document.getElementById('priceLabel');
    const priceInput = document.getElementById('price');
    const priceHint = document.getElementById('priceHint');

    // Airbnb takes priority
    if (isAirbnb || propertyType === 'airbnb') {
        priceLabel.innerHTML = 'Nightly Rate (KES) *';
        priceInput.placeholder = 'e.g., 5000 (per night)';
        priceHint.innerHTML = 'Enter the nightly rate in KES (e.g., 5000).';
    } else if (listingType === 'rent') {
        priceLabel.innerHTML = 'Monthly Rent (KES) *';
        priceInput.placeholder = 'e.g., 50000 (per month)';
        priceHint.innerHTML = 'For rent: enter the monthly rent in KES.';
    } else { // sale
        priceLabel.innerHTML = 'Price (KES) *';
        priceInput.placeholder = 'e.g., 5000000';
        priceHint.innerHTML = 'For sale: total price. For rent: monthly rent. For Airbnb: nightly rate.';
    }
}

// =========================
// Image Management
// =========================
const ImageManager = {
    MAX_MB: 10,
    MAX_FILES: 20,
    selectedImages: [],

    init() {
        if (!imageInput) return;

        imageInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            this.selectedImages = this.sanitizeFiles(files);
            this.syncInput();
            this.previewNewImages();
        });

        const clearBtn = document.getElementById('clearPreview');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.selectedImages = [];
                this.syncInput();
                if (imagePreview) imagePreview.innerHTML = '<p class="text-muted">No images selected</p>';
            });
        }
    },

    sanitizeFiles(files) {
        const valid = [];
        const maxBytes = this.MAX_MB * 1024 * 1024;

        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                Utils.showToast(`${file.name} is not an image`, 'error');
                continue;
            }
            if (file.size > maxBytes) {
                Utils.showToast(`${file.name} exceeds ${this.MAX_MB}MB`, 'error');
                continue;
            }
            valid.push(file);
            if (valid.length >= this.MAX_FILES) break;
        }
        return valid;
    },

    syncInput() {
        if (!imageInput) return;
        const dt = new DataTransfer();
        this.selectedImages.forEach(f => dt.items.add(f));
        imageInput.files = dt.files;
    },

    previewNewImages() {
        if (!imagePreview) return;

        if (!this.selectedImages.length) {
            imagePreview.innerHTML = '<p class="text-muted">No images selected</p>';
            return;
        }

        imagePreview.innerHTML = '';
        this.selectedImages.forEach((file, index) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const div = document.createElement('div');
                div.className = 'preview-image';
                div.innerHTML = `
                    <img src="${e.target.result}" alt="Preview">
                    <span class="image-name">${file.name}</span>
                    <span class="image-size">${Utils.formatFileSize(file.size)}</span>
                    <button type="button" class="remove-selected-btn" data-index="${index}" title="Remove">
                        <i class="fas fa-times"></i>
                    </button>
                `;
                div.querySelector('.remove-selected-btn')?.addEventListener('click', () => {
                    this.selectedImages.splice(index, 1);
                    this.syncInput();
                    this.previewNewImages();
                });
                imagePreview.appendChild(div);
            };
            reader.readAsDataURL(file);
        });
    },

    displayExistingImages(images, publicIds = []) {
        if (!existingPreview) return;
        existingImages = images || [];
        existingPublicIds = publicIds || [];

        if (!existingImages.length) {
            existingPreview.innerHTML = '<p class="text-muted">No existing images</p>';
            return;
        }

        existingPreview.innerHTML = '';
        existingImages.forEach((url, index) => {
            const div = document.createElement('div');
            div.className = 'preview-image existing';
            div.innerHTML = `
                <img src="${url}" alt="Existing image">
                <span class="image-index">${index === 0 ? '⭐ COVER' : `Image ${index + 1}`}</span>
                <button type="button" class="remove-existing-btn" data-index="${index}" title="Remove">
                    <i class="fas fa-times"></i>
                </button>
            `;
            div.querySelector('.remove-existing-btn')?.addEventListener('click', () => {
                existingImages.splice(index, 1);
                existingPublicIds.splice(index, 1);
                this.displayExistingImages(existingImages, existingPublicIds);
                // update form status (optional)
            });
            existingPreview.appendChild(div);
        });
    },

    getFinalImages() {
        return existingImages;
    },

    getFinalPublicIds() {
        return existingPublicIds;
    },

    hasNewImages() {
        return this.selectedImages.length > 0;
    },

    getNewImages() {
        return this.selectedImages;
    }
};

// =========================
// Features / Amenities Management
// =========================
const FeaturesManager = {
    init() {
        const addBtn = document.getElementById('addFeature');
        const input = document.getElementById('featureInput');
        if (addBtn) addBtn.addEventListener('click', () => this.addFeature());
        if (input) input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addFeature();
            }
        });
        this.loadFeatures();
    },

    loadFeatures() {
        const input = document.getElementById('features');
        if (input && input.value) {
            try {
                features = JSON.parse(input.value);
                this.displayFeatures();
            } catch (e) {
                features = [];
            }
        }
    },

    addFeature() {
        const input = document.getElementById('featureInput');
        const feature = input.value.trim();
        if (!feature) return;
        features.push(feature);
        document.getElementById('features').value = JSON.stringify(features);
        this.displayFeatures();
        input.value = '';
        input.focus();
    },

    removeFeature(index) {
        if (confirm('Remove this feature?')) {
            features.splice(index, 1);
            document.getElementById('features').value = JSON.stringify(features);
            this.displayFeatures();
        }
    },

    displayFeatures() {
        const container = document.getElementById('featuresList');
        if (!container) return;
        if (!features.length) {
            container.innerHTML = '<p class="text-muted">No amenities added yet</p>';
            return;
        }
        container.innerHTML = '';
        features.forEach((feature, index) => {
            const tag = document.createElement('span');
            tag.className = 'feature-tag';
            tag.innerHTML = `
                ${feature}
                <button type="button" class="remove-feature" data-index="${index}">
                    <i class="fas fa-times"></i>
                </button>
            `;
            tag.querySelector('.remove-feature')?.addEventListener('click', () => this.removeFeature(index));
            container.appendChild(tag);
        });
    },

    getFeatures() {
        return features;
    }
};

// =========================
// Form Management
// =========================
const FormManager = {
    reset() {
        propertyForm?.reset();
        currentEditId = null;
        existingImages = [];
        existingPublicIds = [];
        features = [];
        ImageManager.selectedImages = [];
        document.getElementById('listingType').value = 'sale';
        document.getElementById('isAirbnb').value = 'false';
        document.querySelectorAll('.transaction-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.transaction === 'sale') btn.classList.add('active');
        });
        document.getElementById('features').value = '[]';
        FeaturesManager.displayFeatures();
        imageInput.value = '';
        imagePreview.innerHTML = '<p class="text-muted">No images selected</p>';
        existingPreview.innerHTML = '<p class="text-muted">No existing images</p>';
        formTitle.textContent = 'Add New Property';
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Create Property';
        submitBtn.disabled = false;
        formStatus.style.display = 'none';
        document.getElementById('propertyId').value = '';
        // Reset property type dropdown
        const typeSelect = document.getElementById('propertyType');
        if (typeSelect) typeSelect.value = '';
        // Reset price field to default
        updatePriceField();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    populateForEdit(property) {
        currentEditId = property._id;
        existingImages = [...(property.images || [])];
        existingPublicIds = [];

        document.getElementById('title').value = property.title || '';
        document.getElementById('estate').value = property.estate || '';
        document.getElementById('county').value = property.county || '';
        document.getElementById('price').value = property.price || '';
        document.getElementById('bedrooms').value = property.bedrooms || 0;
        document.getElementById('description').value = property.description || '';
        document.getElementById('propertyType').value = property.propertyType || '';
        document.getElementById('size').value = property.size || '';
        document.getElementById('bathrooms').value = property.bathrooms || 0;
        document.getElementById('parking').value = property.parking || 0;
        document.getElementById('status').value = property.status || 'available';

        // Set listing type and Airbnb flag
        const listingType = property.listingType || 'sale';
        const isAirbnb = property.isAirbnb || false;
        document.getElementById('listingType').value = listingType;
        document.getElementById('isAirbnb').value = isAirbnb ? 'true' : 'false';

        // Update transaction buttons
        document.querySelectorAll('.transaction-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.transaction === listingType) btn.classList.add('active');
        });
        // Special case: if Airbnb, highlight the Airbnb button
        if (isAirbnb) {
            document.getElementById('airbnbBtn')?.classList.add('active');
        }

        // Amenities
        features = [...(property.amenities || [])];
        document.getElementById('features').value = JSON.stringify(features);
        FeaturesManager.displayFeatures();

        // Images
        ImageManager.displayExistingImages(property.images || []);

        // Update price label/hint
        updatePriceField();

        formTitle.textContent = `Edit Property: ${property.title}`;
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Update Property';
        document.getElementById('propertyId').value = property._id;
        formStatus.style.display = 'block';
        formStatus.className = 'existing-images-notice';
        formStatus.textContent = `Editing property: ${property.title}`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    updateStatus(message, type = 'info') {
        if (!formStatus) return;
        formStatus.style.display = 'block';
        formStatus.textContent = message;
        formStatus.className = type === 'info' ? 'existing-images-notice' : type;
    }
};

// =========================
// Property API (RentSpace)
// =========================
const PropertyAPI = {
    async fetchMyProperties() {
        // ── Check if user is admin ──────────────────────────────────
        let isAdmin = false;
        try {
            const user = JSON.parse(localStorage.getItem('rentspace_user') || '{}');
            isAdmin = user.role === 'admin';
        } catch (e) {
            // If user data isn't available, treat as regular user
        }

        // ── Admin: fetch all properties (limit 100) ──────────────
        //    Regular user: fetch default page (20)
        const limit = isAdmin ? 100 : 20;
        const url = `${API_BASE}/api/properties/my-properties?limit=${limit}`;

        const res = await authFetch(url);
        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || 'Failed to fetch properties');
        }
        const data = await res.json();
        console.log('📥 API response:', data); // For debugging

        // ── Ensure we return an array ──────────────────────────────
        if (Array.isArray(data)) return data;
        if (data.properties && Array.isArray(data.properties)) return data.properties;
        if (data.success && Array.isArray(data.data)) return data.data;
        if (data.error) throw new Error(data.error);
        return []; // fallback
    },

    async getPropertyById(id) {
        const res = await authFetch(`${API_BASE}/api/properties/${id}`);
        if (!res.ok) throw new Error('Property not found');
        return await res.json();
    },

    async createProperty(formData) {
        const res = await fetch(`${API_BASE}/api/properties`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData
        });
        if (!res.ok) {
            // Try to parse JSON error
            let errMsg;
            try {
                const errData = await res.json();
                errMsg = errData.error || 'Creation failed';
            } catch (e) {
                errMsg = await res.text() || 'Creation failed';
            }
            throw new Error(errMsg);
        }
        return await res.json();
    },

    async updateProperty(id, formData) {
        const res = await fetch(`${API_BASE}/api/properties/${id}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData
        });
        if (!res.ok) {
            let errMsg;
            try {
                const errData = await res.json();
                errMsg = errData.error || 'Update failed';
            } catch (e) {
                errMsg = await res.text() || 'Update failed';
            }
            throw new Error(errMsg);
        }
        return await res.json();
    },

    async deleteProperty(id) {
        const res = await authFetch(`${API_BASE}/api/properties/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Delete failed');
        return true;
    }
};

// =========================
// Properties Table
// =========================
const PropertiesTable = {
    currentPage: 1,
    itemsPerPage: 10,

    render(properties) {
        allProperties = properties;
        this.currentPage = 1;
        this.renderPage();
        this.renderPagination();
        if (propertyCountDisplay) propertyCountDisplay.textContent = properties.length;
    },

    renderPage() {
        if (!propertiesTable) return;
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const pageProperties = allProperties.slice(start, start + this.itemsPerPage);

        if (!allProperties.length) {
            propertiesTable.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center" style="padding:40px;">
                        <i class="fas fa-home fa-2x mb-3"></i>
                        <p>No properties yet. Start by adding one above!</p>
                    </td>
                </tr>
            `;
            return;
        }

        propertiesTable.innerHTML = '';
        pageProperties.forEach(property => {
            const tr = document.createElement('tr');
            const thumbSrc = property.images && property.images[0] ? property.images[0] : 'https://via.placeholder.com/44x34?text=No+Img';
            // Determine listing display
            let listingDisplay = (property.listingType || '').toUpperCase();
            if (property.isAirbnb) listingDisplay = 'AIRBNB';
            tr.innerHTML = `
                <td><strong>${this.escapeHtml(property.title)}</strong></td>
                <td>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <img src="${thumbSrc}" alt="thumb" style="width:44px;height:34px;object-fit:cover;border-radius:8px;cursor:pointer;"
                             data-property-id="${property._id}" class="thumbnail-clickable">
                        <span class="badge bg-success">${property.images ? property.images.length : 0}</span>
                    </div>
                </td>
                <td>${this.escapeHtml(property.estate || '')}</td>
                <td>${this.escapeHtml(property.propertyType || '')}</td>
                <td>${listingDisplay}</td>
                <td>${Utils.formatPrice(property.price)}</td>
                <td><span class="status-badge ${property.status || 'draft'}">${property.status || 'Draft'}</span></td>
                <td class="actions">
                    <button class="btn btn-outline edit-btn" data-id="${property._id}"><i class="fas fa-edit"></i> Edit</button>
                    <button class="btn btn-danger delete-btn" data-id="${property._id}"><i class="fas fa-trash"></i> Delete</button>
                </td>
            `;
            propertiesTable.appendChild(tr);
        });
        this.attachEventListeners();
    },

    renderPagination() {
        if (!paginationControls) return;
        const totalPages = Math.ceil(allProperties.length / this.itemsPerPage);
        if (totalPages <= 1) {
            paginationControls.innerHTML = '';
            return;
        }
        let html = '';
        if (this.currentPage > 1) {
            html += `<button class="pagination-btn" data-page="${this.currentPage - 1}">Prev</button>`;
        }
        for (let i = 1; i <= totalPages; i++) {
            if (i === this.currentPage) {
                html += `<button class="pagination-btn active" data-page="${i}">${i}</button>`;
            } else if (Math.abs(i - this.currentPage) <= 2 || i === 1 || i === totalPages) {
                html += `<button class="pagination-btn" data-page="${i}">${i}</button>`;
            } else if (Math.abs(i - this.currentPage) === 3) {
                html += `<span style="margin:0 4px;">...</span>`;
            }
        }
        if (this.currentPage < totalPages) {
            html += `<button class="pagination-btn" data-page="${this.currentPage + 1}">Next</button>`;
        }
        paginationControls.innerHTML = html;
        paginationControls.querySelectorAll('.pagination-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const page = parseInt(btn.dataset.page);
                if (!isNaN(page)) {
                    this.currentPage = page;
                    this.renderPage();
                    this.renderPagination();
                }
            });
        });
    },

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    },

    attachEventListeners() {
        // Edit buttons
        propertiesTable.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                try {
                    const property = await PropertyAPI.getPropertyById(id);
                    FormManager.populateForEdit(property);
                } catch (error) {
                    Utils.showToast('Failed to load property', 'error');
                }
            });
        });

        // Delete buttons
        propertiesTable.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                if (!confirm('Delete this property permanently?')) return;
                try {
                    await PropertyAPI.deleteProperty(id);
                    Utils.showToast('Property deleted');
                    await PropertiesTable.loadAndRender();
                    if (currentEditId === id) FormManager.reset();
                } catch (error) {
                    Utils.showToast('Failed to delete', 'error');
                }
            });
        });

        // Thumbnail click -> open modal
        propertiesTable.querySelectorAll('.thumbnail-clickable').forEach(thumb => {
            thumb.addEventListener('click', () => {
                const id = thumb.dataset.propertyId;
                const property = allProperties.find(p => p._id === id);
                if (property && property.images && property.images.length) {
                    ImageModal.open(property.images);
                }
            });
        });
    },

    async loadAndRender() {
        this.showLoading();
        try {
            const properties = await PropertyAPI.fetchMyProperties();
            this.render(properties);
        } catch (error) {
            this.showError(error.message);
        }
    },

    showLoading() {
        if (!propertiesTable) return;
        propertiesTable.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;
        if (paginationControls) paginationControls.innerHTML = '';
    },

    showError(error) {
        if (!propertiesTable) return;
        propertiesTable.innerHTML = `<tr><td colspan="8" style="text-align:center;color:red;padding:40px;">Error: ${error}</td></tr>`;
        if (paginationControls) paginationControls.innerHTML = '';
    }
};

// =========================
// Image Modal
// =========================
const ImageModal = {
    modal: null,
    images: [],
    currentIndex: 0,

    init() {
        this.modal = document.getElementById('imageModal');
        if (!this.modal) return;

        document.querySelector('.modal-close')?.addEventListener('click', () => this.close());
        this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.close(); });
        document.getElementById('modalPrev')?.addEventListener('click', () => this.prev());
        document.getElementById('modalNext')?.addEventListener('click', () => this.next());
    },

    open(images, startIndex = 0) {
        if (!images || !images.length) return;
        this.images = images;
        this.currentIndex = startIndex;
        this.updateImage();
        this.modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    },

    close() {
        this.modal.classList.remove('show');
        document.body.style.overflow = '';
    },

    next() {
        this.currentIndex = (this.currentIndex + 1) % this.images.length;
        this.updateImage();
    },

    prev() {
        this.currentIndex = (this.currentIndex - 1 + this.images.length) % this.images.length;
        this.updateImage();
    },

    updateImage() {
        const img = document.getElementById('modalImage');
        const counter = document.getElementById('modalCounter');
        if (img) img.src = this.images[this.currentIndex];
        if (counter) counter.textContent = `${this.currentIndex + 1} / ${this.images.length}`;
    }
};

// =========================
// Refresh User Data
// =========================
async function refreshUserData() {
    try {
        const token = getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            const user = data.user || data;
            localStorage.setItem('rentspace_user', JSON.stringify(user));
            // Update subscription UI
            await loadSubscriptionData();
        }
    } catch (error) {
        console.error('Failed to refresh user data:', error);
    }
}

// =========================
// Retry Pending Property
// =========================
async function retryPendingProperty() {
    if (!pendingFormData) return;

    try {
        Utils.showToast('🔄 Retrying your property creation...', 'info');
        await PropertyAPI.createProperty(pendingFormData);
        Utils.showToast('✅ Property created successfully!', 'success');
        pendingFormData = null;
        FormManager.reset();
        await PropertiesTable.loadAndRender();
    } catch (error) {
        console.error('Retry failed:', error);
        Utils.showToast('Please try creating your property again manually.', 'error');
        // Don't clear pendingFormData – user might want to retry later
    }
}

// =========================
// Subscription Functions
// =========================

// Load subscription data and update the UI card
async function loadSubscriptionData() {
    try {
        const user = JSON.parse(localStorage.getItem('rentspace_user'));
        if (!user) return;

        const plan = user.subscriptionPlan || 'free';
        const expiry = user.subscriptionExpiry ? new Date(user.subscriptionExpiry) : null;
        const isPaid = ['basic', 'pro', 'developer'].includes(plan);
        const isExpired = expiry && expiry < new Date();

        // ─── Get listing count ──────────────────────────────────
        let listingsUsed = 0;
        try {
            const properties = await PropertyAPI.fetchMyProperties();
            listingsUsed = properties.length;
        } catch (e) {
            // If user can't fetch properties, just show 0
        }

        // ─── Update UI ──────────────────────────────────────────
        if (isPaid && !isExpired) {
            // Paid user – show active plan
            document.getElementById('currentPlan').textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
            document.getElementById('planBadge').textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
            document.getElementById('planBadge').className = 'plan-badge active';
            document.getElementById('planStatus').textContent = 'Active';
            document.getElementById('planStatus').style.color = '#4CAF50';
            document.getElementById('planExpiry').textContent = expiry ? expiry.toLocaleDateString() : '—';
            document.getElementById('listingsUsed').textContent = listingsUsed;
            document.getElementById('planActions').innerHTML = '';
        } else {
            // ─── No active subscription ──────────────────────────
            document.getElementById('currentPlan').textContent = 'No Active Subscription';
            document.getElementById('planBadge').textContent = 'Inactive';
            document.getElementById('planBadge').className = 'plan-badge inactive';
            document.getElementById('planStatus').textContent = 'Inactive';
            document.getElementById('planStatus').style.color = '#ff6b6b';
            document.getElementById('planExpiry').textContent = '—';
            document.getElementById('listingsUsed').textContent = '—';

            // ─── Show upgrade CTA ────────────────────────────────
            document.getElementById('planActions').innerHTML = `
                <div style="background:#2a1a1a; border-left:4px solid #c5a059; padding:12px 16px; border-radius:6px; margin-bottom:10px;">
                    <p style="margin:0; color:#eaeaea;">
                        <i class="fas fa-lock" style="color:#c5a059;"></i>
                        You need an active subscription to list properties.
                    </p>
                </div>
                <button class="btn btn-primary" id="upgradeBtn" style="width:100%; padding:12px;">
                    <i class="fas fa-rocket"></i> Subscribe Now – From KES 2,500/mo
                </button>
            `;
            document.getElementById('upgradeBtn').addEventListener('click', openUpgradeModal);
        }

    } catch (error) {
        console.error('Error loading subscription data:', error);
    }
}

// Open upgrade modal and fetch plans
async function openUpgradeModal() {
    const modal = document.getElementById('upgradeModal');
    const planList = document.getElementById('planList');
    modal.style.display = 'flex';

    // ── Get current property data for the summary ──────────────
    const title = document.getElementById('title')?.value?.trim() || '';
    const estate = document.getElementById('estate')?.value?.trim() || '';
    const county = document.getElementById('county')?.value?.trim() || '';
    const price = parseFloat(document.getElementById('price')?.value || 0);
    const imageCount = ImageManager.getNewImages().length;
    const hasPending = pendingFormData !== null;
    const isEdit = currentEditId !== null;

    // ── Build property summary ──────────────────────────────────
    let summaryHTML = '';
    if (hasPending || title || estate || price) {
        const location = estate && county ? `${estate}, ${county}` : estate || county || '—';
        summaryHTML = `
            <div class="modal-property-summary">
                <div class="summary-label">${hasPending ? '📌 You\'re about to list' : isEdit ? '✏️ Editing' : '📋 Property details'}</div>
                <div class="summary-title">${title || 'Untitled'}</div>
                <div class="summary-meta">
                    📍 ${location} ${price > 0 ? `• 💰 KES ${price.toLocaleString()}` : ''} ${imageCount > 0 ? `• 📸 ${imageCount} image${imageCount > 1 ? 's' : ''}` : ''}
                </div>
                ${hasPending ? `<div class="summary-saved"><i class="fas fa-check-circle"></i> Your property data is saved – upgrade to publish it!</div>` : ''}
            </div>
        `;
    } else {
        summaryHTML = `
            <div class="modal-property-summary" style="border-left-color:#c5a059;">
                <div class="summary-meta" style="font-size:14px; color:#aaa;">
                    <i class="fas fa-rocket" style="color:#c5a059;"></i> Upgrade your plan to start listing properties.
                </div>
            </div>
        `;
    }

    // ── Pre-fill phone number ──────────────────────────────────
    const user = JSON.parse(localStorage.getItem('rentspace_user') || '{}');
    let userPhone = '';
    if (user.phone) {
        userPhone = user.phone.replace(/\s/g, '').replace(/^\+/, '');
        if (!userPhone.startsWith('254')) {
            userPhone = '254' + userPhone.replace(/^0+/, '');
        }
    }

    // ── Define packages ──────────────────────────────────────────
    // These map to your backend plans: basic, pro, developer
    const PACKAGES = {
        monthly: [
            {
                id: 'basic',
                name: 'Basic',
                icon: 'fa-star',
                price: 2500,
                period: 'month',
                features: ['20 listings', '📊 Basic analytics', 'Email support', 'WhatsApp leads'],
                popular: false,
                color: '#c5a059'
            },
            {
                id: 'pro',
                name: 'Silver',
                icon: 'fa-gem',
                price: 5000,
                period: 'month',
                features: ['Unlimited listings', '📊 Advanced analytics', 'Priority support', 'WhatsApp leads', '⭐ Featured placement'],
                popular: true,
                color: '#b0b0b0'
            },
            {
                id: 'developer',
                name: 'Gold',
                icon: 'fa-crown',
                price: 10000,
                period: 'month',
                features: ['Unlimited listings', '📊 Premium analytics', '24/7 priority support', 'WhatsApp leads', '⭐ Featured placement', '🔌 API access', '📦 Bulk upload'],
                popular: false,
                color: '#d4a843'
            }
        ],
        weekly: [
            {
                id: 'basic',
                name: 'Basic',
                icon: 'fa-star',
                price: 700, // ~2500/4
                period: 'week',
                features: ['20 listings', '📊 Basic analytics', 'Email support', 'WhatsApp leads'],
                popular: false,
                color: '#c5a059'
            },
            {
                id: 'pro',
                name: 'Silver',
                icon: 'fa-gem',
                price: 1400, // ~5000/4
                period: 'week',
                features: ['Unlimited listings', '📊 Advanced analytics', 'Priority support', 'WhatsApp leads', '⭐ Featured placement'],
                popular: true,
                color: '#b0b0b0'
            },
            {
                id: 'developer',
                name: 'Gold',
                icon: 'fa-crown',
                price: 2800, // ~10000/4
                period: 'week',
                features: ['Unlimited listings', '📊 Premium analytics', '24/7 priority support', 'WhatsApp leads', '⭐ Featured placement', '🔌 API access', '📦 Bulk upload'],
                popular: false,
                color: '#d4a843'
            }
        ]
    };

    let currentPeriod = 'monthly';

    // ── Render the plan cards ────────────────────────────────────
    function renderPlans(period) {
        const plans = PACKAGES[period] || PACKAGES.monthly;
        const periodLabel = period === 'monthly' ? 'per month' : 'per week';

        let html = `
            <div class="modal-packages">
                <div class="modal-period-toggle">
                    <button class="period-btn ${period === 'monthly' ? 'active' : ''}" data-period="monthly">Monthly</button>
                    <button class="period-btn ${period === 'weekly' ? 'active' : ''}" data-period="weekly">Weekly</button>
                    <span class="toggle-savings">Save 15% with monthly</span>
                </div>
                <div class="packages-grid">
        `;

        plans.forEach((pkg, index) => {
            const popularBadge = pkg.popular ? `<div class="popular-badge">🔥 Most Popular</div>` : '';
            html += `
                <div class="package-card ${pkg.popular ? 'popular' : ''}" data-plan="${pkg.id}" data-period="${period}">
                    ${popularBadge}
                    <div class="package-header">
                        <i class="fas ${pkg.icon}" style="color:${pkg.color};"></i>
                        <h4>${pkg.name}</h4>
                    </div>
                    <div class="package-price">
                        <span class="price-amount">KES ${pkg.price.toLocaleString()}</span>
                        <span class="price-period">/${pkg.period}</span>
                    </div>
                    <ul class="package-features">
                        ${pkg.features.map(f => `<li><i class="fas fa-check" style="color:#c5a059;"></i> ${f}</li>`).join('')}
                    </ul>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;

        return html;
    }

    // ─── Render the full modal content ────────────────────────────
    planList.innerHTML = `
        ${summaryHTML}
        ${renderPlans(currentPeriod)}
        <div class="modal-phone-section">
            <label for="subscribePhone">📱 Phone Number (STK Push)</label>
            <input type="tel" id="subscribePhone" placeholder="2547XXXXXXXX" value="${userPhone}">
        </div>
        <div class="modal-actions">
            <button class="btn btn-primary" id="subscribeBtn">Subscribe Now</button>
            <button class="btn btn-outline" id="closeModalBtn">Cancel</button>
        </div>
    `;

    // ─── Re-bind events ──────────────────────────────────────────
    // Period toggle
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const period = this.dataset.period;
            currentPeriod = period;
            // Re-render with the selected period
            const currentSummary = planList.querySelector('.modal-property-summary')?.outerHTML || '';
            const phoneSection = planList.querySelector('.modal-phone-section')?.outerHTML || '';
            const actions = planList.querySelector('.modal-actions')?.outerHTML || '';
            planList.innerHTML = `
                ${currentSummary || summaryHTML}
                ${renderPlans(period)}
                ${phoneSection}
                ${actions}
            `;
            // Re-bind package clicks
            bindPackageClicks();
            // Re-bind period toggles
            document.querySelectorAll('.period-btn').forEach(b => {
                b.addEventListener('click', arguments.callee);
            });
            // Re-bind subscribe button
            document.getElementById('subscribeBtn')?.addEventListener('click', handleSubscription);
            // Re-bind close button
            document.getElementById('closeModalBtn')?.addEventListener('click', () => {
                document.getElementById('upgradeModal').style.display = 'none';
            });
        });
    });

    function bindPackageClicks() {
        document.querySelectorAll('.package-card').forEach(el => {
            el.addEventListener('click', function() {
                document.querySelectorAll('.package-card').forEach(c => c.classList.remove('selected'));
                this.classList.add('selected');
                this.dataset.selected = 'true';
                // Highlight the selected card with a glow
                this.style.borderColor = '#c5a059';
                this.style.boxShadow = '0 0 30px rgba(197, 160, 89, 0.25)';
            });
        });
    }

    bindPackageClicks();

    // ─── Re-bind subscribe button ──────────────────────────────
    document.getElementById('subscribeBtn')?.addEventListener('click', handleSubscription);

    // ─── Re-bind close button ──────────────────────────────────
    document.getElementById('closeModalBtn')?.addEventListener('click', () => {
        document.getElementById('upgradeModal').style.display = 'none';
    });

    // ─── Update subscribe handler to read selected package ────
    // Override handleSubscription to use the new package selection
    const originalHandleSubscription = handleSubscription;
    handleSubscription = async function() {
        const selected = document.querySelector('.package-card.selected');
        if (!selected) {
            Utils.showToast('Please select a plan.', 'error');
            return;
        }
        const plan = selected.dataset.plan;
        const period = selected.dataset.period || 'monthly';
        const phone = document.getElementById('subscribePhone').value.trim();
        if (!phone || !/^254\d{9}$/.test(phone)) {
            Utils.showToast('Please enter a valid phone number (2547XXXXXXXX).', 'error');
            return;
        }

        const btn = document.getElementById('subscribeBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/api/subscriptions/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ plan, phoneNumber: phone })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Subscription failed');

            Utils.showToast('STK push sent. Check your phone.', 'success');
            document.getElementById('upgradeModal').style.display = 'none';

            await refreshUserData();
            setTimeout(async () => {
                await retryPendingProperty();
            }, 2000);

        } catch (error) {
            Utils.showToast(error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Subscribe Now';
        }
    };

    // ─── Override the global handleSubscription ────────────────
    // This ensures the subscribe button uses the updated handler
    document.getElementById('subscribeBtn')?.addEventListener('click', handleSubscription);
}

// Handle subscription submission
async function handleSubscription() {
    const selected = document.querySelector('.plan-option[data-selected="true"]');
    if (!selected) {
        Utils.showToast('Please select a plan.', 'error');
        return;
    }
    const plan = selected.dataset.plan;
    const phone = document.getElementById('subscribePhone').value.trim();
    if (!phone || !/^254\d{9}$/.test(phone)) {
        Utils.showToast('Please enter a valid phone number (2547XXXXXXXX).', 'error');
        return;
    }

    const btn = document.getElementById('subscribeBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/subscriptions/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ plan, phoneNumber: phone })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Subscription failed');

        Utils.showToast('STK push sent. Check your phone.', 'success');
        document.getElementById('upgradeModal').style.display = 'none';

        // ── Refresh user data and retry pending property ──────
        await refreshUserData(); // updates localStorage and subscription UI

        // Wait a moment for the backend to fully process (optional)
        setTimeout(async () => {
            await retryPendingProperty();
        }, 2000);

    } catch (error) {
        Utils.showToast(error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Subscribe';
    }
}

// =========================
// Form Submit Handler
// =========================
async function handleFormSubmit(e) {
    e.preventDefault();

    // ── Validation ──────────────────────────────────────────────
    const title = document.getElementById('title')?.value.trim();
    const estate = document.getElementById('estate')?.value.trim();
    const county = document.getElementById('county')?.value.trim();
    const price = parseFloat(document.getElementById('price')?.value || 0);
    const description = document.getElementById('description')?.value.trim();
    const propertyType = document.getElementById('propertyType')?.value;

    if (!title) { Utils.showToast('Title is required', 'error'); return; }
    if (!estate) { Utils.showToast('Estate is required', 'error'); return; }
    if (!county) { Utils.showToast('County is required', 'error'); return; }
    if (!propertyType) { Utils.showToast('Property type is required', 'error'); return; }
    if (isNaN(price) || price <= 0) { Utils.showToast('Valid price is required', 'error'); return; }
    if (!description) { Utils.showToast('Description is required', 'error'); return; }

    // If creating new, require at least one image
    if (!currentEditId && ImageManager.getNewImages().length === 0) {
        Utils.showToast('Please select at least one image', 'error');
        return;
    }

    // ── Build FormData ──────────────────────────────────────────
    const formData = new FormData();
    formData.append('title', title);
    formData.append('listingType', document.getElementById('listingType')?.value || 'sale');
    formData.append('isAirbnb', document.getElementById('isAirbnb')?.value === 'true');
    formData.append('propertyType', propertyType);
    formData.append('estate', estate);
    formData.append('county', county);
    formData.append('price', price);
    formData.append('bedrooms', document.getElementById('bedrooms')?.value || 0);
    formData.append('bathrooms', document.getElementById('bathrooms')?.value || 0);
    formData.append('parking', document.getElementById('parking')?.value || 0);
    formData.append('size', document.getElementById('size')?.value || '');
    formData.append('status', document.getElementById('status')?.value || 'available');
    formData.append('description', description);
    formData.append('amenities', JSON.stringify(features));

    // Append new images
    ImageManager.getNewImages().forEach(file => formData.append('images', file));

    // For edit, send existing image URLs and public IDs (if any)
    if (currentEditId) {
        formData.append('existingImages', JSON.stringify(existingImages));
        formData.append('existingPublicIds', JSON.stringify(existingPublicIds));
    }

    // ── Disable submit button ──────────────────────────────────
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${currentEditId ? 'Updating...' : 'Creating...'}`;

    try {
        if (currentEditId) {
            await PropertyAPI.updateProperty(currentEditId, formData);
            Utils.showToast('Property updated successfully');
            FormManager.reset();
            await PropertiesTable.loadAndRender();
        } else {
            await PropertyAPI.createProperty(formData);
            Utils.showToast('Property created successfully');
            FormManager.reset();
            await PropertiesTable.loadAndRender();
        }
    } catch (error) {
        console.error('Save error:', error);

        // ─── 🚨 Check if it's a subscription error (403) ──────
        const errorMsg = error.message || '';
        const isSubscriptionError =
            errorMsg.toLowerCase().includes('subscription') ||
            errorMsg.toLowerCase().includes('subscribe') ||
            errorMsg.toLowerCase().includes('upgrade');

        if (isSubscriptionError) {
            // ── Store pending data ──────────────────────────────
            pendingFormData = formData;

            // ── Show a friendly upgrade prompt ──────────────────
            Utils.showToast('📢 You need a subscription to list properties. Upgrade now!', 'warning');

            // ── Open the upgrade modal ──────────────────────────
            setTimeout(() => {
                openUpgradeModal();

                // Scroll to subscription section
                const subCard = document.getElementById('subscriptionCard');
                if (subCard) {
                    subCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                // Highlight the subscription card
                if (subCard) {
                    subCard.style.borderColor = '#c5a059';
                    subCard.style.boxShadow = '0 0 20px rgba(197, 160, 89, 0.3)';
                    setTimeout(() => {
                        subCard.style.borderColor = '#2c2c2c';
                        subCard.style.boxShadow = 'none';
                    }, 3000);
                }
            }, 500);
        } else {
            // ── Generic error ────────────────────────────────────
            Utils.showToast(errorMsg || 'Failed to save property', 'error');
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = currentEditId
            ? '<i class="fas fa-save"></i> Update Property'
            : '<i class="fas fa-save"></i> Create Property';
    }
}

// =========================
// Initialization
// =========================
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    if (!getToken()) {
        redirectToLogin();
        return;
    }

    // Initialize modules
    ImageManager.init();
    FeaturesManager.init();
    ImageModal.init();

    // Set up transaction buttons (Sale, Rent, Airbnb)
    document.querySelectorAll('.transaction-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.transaction-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const transaction = this.dataset.transaction;
            document.getElementById('listingType').value = transaction;
            
            // Handle Airbnb special case
            if (this.id === 'airbnbBtn') {
                document.getElementById('isAirbnb').value = 'true';
                // Auto-select property type to Airbnb
                const typeSelect = document.getElementById('propertyType');
                if (typeSelect) {
                    typeSelect.value = 'airbnb';
                }
            } else {
                document.getElementById('isAirbnb').value = 'false';
                // If user clicks Sale or Rent, reset property type if it was Airbnb
                const typeSelect = document.getElementById('propertyType');
                if (typeSelect && typeSelect.value === 'airbnb') {
                    typeSelect.value = '';
                }
            }
            updatePriceField();
        });
    });

    // Property Type change – update price and Airbnb flag
    document.getElementById('propertyType')?.addEventListener('change', function() {
        const val = this.value;
        if (val === 'airbnb') {
            document.getElementById('isAirbnb').value = 'true';
            // Also highlight Airbnb button
            document.querySelectorAll('.transaction-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('airbnbBtn')?.classList.add('active');
            document.getElementById('listingType').value = 'rent';
        } else {
            // If they switch away from Airbnb, reset flag (but keep listing type as is)
            document.getElementById('isAirbnb').value = 'false';
            // If currently Airbnb button active, remove it
            const airbnbBtn = document.getElementById('airbnbBtn');
            if (airbnbBtn && airbnbBtn.classList.contains('active')) {
                airbnbBtn.classList.remove('active');
                // Activate appropriate button based on listingType
                const currentListing = document.getElementById('listingType').value;
                document.querySelectorAll('.transaction-btn').forEach(b => {
                    if (b.dataset.transaction === currentListing) b.classList.add('active');
                });
            }
        }
        updatePriceField();
    });

    // Form submit
    propertyForm?.addEventListener('submit', handleFormSubmit);

    // Reset button
    resetBtn?.addEventListener('click', () => {
        if (currentEditId && !confirm('Discard changes?')) return;
        FormManager.reset();
    });

    // Logout
    logoutBtn?.addEventListener('click', () => {
        localStorage.removeItem('rentspace_token');
        window.location.href = 'login.html';
    });

    // ─── Subscription Modal Events ──────────────────────────────
    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            document.getElementById('upgradeModal').style.display = 'none';
        });
    }
    const subscribeBtn = document.getElementById('subscribeBtn');
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', handleSubscription);
    }

    // Load properties and subscription data
    await PropertiesTable.loadAndRender();
    await loadSubscriptionData();
});