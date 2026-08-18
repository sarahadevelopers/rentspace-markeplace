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
// =============================================

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
// Global State
// =========================
let currentEditId = null;
let existingImages = [];        // URLs of existing images
let existingPublicIds = [];     // (optional) Cloudinary public IDs
let allProperties = [];
let features = [];              // amenities list
let selectedImages = [];        // File objects for new images

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
        const res = await authFetch(`${API_BASE}/api/properties/my-properties`);
        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || 'Failed to fetch properties');
        }
        return await res.json();
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
            const err = await res.text();
            throw new Error(err || 'Creation failed');
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
            const err = await res.text();
            throw new Error(err || 'Update failed');
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
// Form Submit Handler
// =========================
async function handleFormSubmit(e) {
    e.preventDefault();

    // Validation
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

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${currentEditId ? 'Updating...' : 'Creating...'}`;

    try {
        if (currentEditId) {
            await PropertyAPI.updateProperty(currentEditId, formData);
            Utils.showToast('Property updated successfully');
        } else {
            await PropertyAPI.createProperty(formData);
            Utils.showToast('Property created successfully');
        }
        FormManager.reset();
        await PropertiesTable.loadAndRender();
    } catch (error) {
        console.error('Save error:', error);
        Utils.showToast(error.message || 'Failed to save property', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = currentEditId ? '<i class="fas fa-save"></i> Update Property' : '<i class="fas fa-save"></i> Create Property';
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

    // Load properties
    await PropertiesTable.loadAndRender();
});