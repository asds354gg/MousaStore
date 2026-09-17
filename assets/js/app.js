/* ============================================================
   Mousa Store — app.js
   Product rendering, cart (localStorage), Instagram checkout.
   Exposes a single shared namespace: window.MousaStore
   ============================================================ */
"use strict";

const MousaStore = (() => {
  /* ----------------------------------------------------------
     Configuration — edit these for your own store.
     ---------------------------------------------------------- */
  const CONFIG = {
    PRODUCTS_URL: "assets/data/products.json",
    CART_KEY: "mousa_store_cart",
    OVERRIDES_KEY: "mousa_store_overrides",
    AUTH_KEY: "mousa_store_admin_auth",
    INSTAGRAM_USERNAME: "mousa.store",
    CURRENCY: "$",
    DEFAULT_IMAGE: "https://placehold.co/480x360/e2e8f0/475569?text=Product",
  };

  const IG_DM_URL = `https://ig.me/m/${CONFIG.INSTAGRAM_USERNAME}`;

  /* ----------------------------------------------------------
     Small JSON helpers for localStorage
     ---------------------------------------------------------- */
  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  /* ----------------------------------------------------------
     Cart — stored as { [productId]: quantity }
     ---------------------------------------------------------- */
  const cart = {
    all() {
      return readJson(CONFIG.CART_KEY, {});
    },

    save(items) {
      writeJson(CONFIG.CART_KEY, items);
      updateCartCount();
    },

    add(id, qty) {
      const items = this.all();
      items[id] = Math.min(99, Math.max(1, (items[id] || 0) + Math.max(1, qty)));
      this.save(items);
    },

    setQuantity(id, qty) {
      const items = this.all();
      if (qty < 1) {
        delete items[id];
      } else {
        items[id] = Math.min(99, qty);
      }
      this.save(items);
    },

    remove(id) {
      const items = this.all();
      delete items[id];
      this.save(items);
    },

    clear() {
      this.save({});
    },

    count() {
      return Object.values(this.all()).reduce((sum, qty) => sum + qty, 0);
    },
  };

  /* ----------------------------------------------------------
     Admin overrides — products.json cannot be edited on a
     static host, so admin changes are stored in localStorage
     and merged on top of the base JSON at load time.
     Shape: { deleted: string[], added: Product[], updates: { [id]: Partial } }
     ---------------------------------------------------------- */
  const overrides = {
    read() {
      return readJson(CONFIG.OVERRIDES_KEY, {
        deleted: [],
        added: [],
        updates: {},
      });
    },

    merge(existing) {
      return {
        deleted: existing.deleted || [],
        added: existing.added || [],
        updates: existing.updates || {},
      };
    },

    deleteProduct(id) {
      const ovr = this.merge(this.read());
      if (!ovr.deleted.includes(id)) ovr.deleted.push(id);
      writeJson(CONFIG.OVERRIDES_KEY, ovr);
    },

    addProduct(product) {
      const ovr = this.merge(this.read());
      ovr.added.unshift(product);
      writeJson(CONFIG.OVERRIDES_KEY, ovr);
    },

    setStock(id, stock) {
      const ovr = this.merge(this.read());
      ovr.updates[id] = { ...(ovr.updates[id] || {}), stock };
      writeJson(CONFIG.OVERRIDES_KEY, ovr);
    },

    clearAll() {
      localStorage.removeItem(CONFIG.OVERRIDES_KEY);
    },
  };

  /* ----------------------------------------------------------
     Product loading + overlay merging
     ---------------------------------------------------------- */
  let baseProducts = [];

  function mergeProducts(base) {
    const ovr = overrides.read();
    const kept = base.filter((p) => !ovr.deleted.includes(p.id));
    const merged = kept.map((p) => {
      const patch = ovr.updates[p.id];
      return patch ? { ...p, ...patch } : p;
    });
    return [...ovr.added, ...merged];
  }

  async function loadProducts() {
    const res = await fetch(CONFIG.PRODUCTS_URL, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Could not load ${CONFIG.PRODUCTS_URL} (HTTP ${res.status})`);
    }
    baseProducts = await res.json();
    return mergeProducts(baseProducts);
  }

  /* ----------------------------------------------------------
     Formatting helpers
     ---------------------------------------------------------- */
  const formatPrice = (value) => `${CONFIG.CURRENCY}${Number(value).toFixed(2)}`;

  const stockLabel = (stock) =>
    stock === "out-of-stock" ? "Out of stock" : "In stock";

  /* ----------------------------------------------------------
     Toast notifications
     ---------------------------------------------------------- */
  function showToast(message, type = "success") {
    let container = document.querySelector(".toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  /* ----------------------------------------------------------
     Header cart badge
     ---------------------------------------------------------- */
  function updateCartCount() {
    const badge = document.getElementById("cartCount");
    if (!badge) return;
    const count = cart.count();
    badge.textContent = count;
    badge.style.display = count > 0 ? "grid" : "none";
  }

  /* ----------------------------------------------------------
     Home page: product grid rendering
     ---------------------------------------------------------- */
  function renderProducts(products) {
    const grid = document.getElementById("productGrid");
    if (!grid) return;

    const card = (p) => {
      const unavailable = p.stock === "out-of-stock";
      const stock = document.createElement("span");
      stock.className = `badge ${p.stock}`;
      stock.textContent = stockLabel(p.stock);

      const thumb = document.createElement("div");
      thumb.className = "thumb";
      const img = document.createElement("img");
      img.src = p.image || CONFIG.DEFAULT_IMAGE;
      img.alt = p.name;
      img.loading = "lazy";
      thumb.appendChild(img);
      thumb.appendChild(stock);

      const name = document.createElement("h3");
      name.className = "product-name";
      name.textContent = p.name;

      const price = document.createElement("div");
      price.className = "product-price";
      price.textContent = formatPrice(p.price);

      const qtyInput = document.createElement("input");
      qtyInput.type = "number";
      qtyInput.min = "1";
      qtyInput.max = "99";
      qtyInput.value = "1";
      qtyInput.setAttribute("aria-label", `Quantity of ${p.name}`);
      qtyInput.disabled = unavailable;

      const addBtn = document.createElement("button");
      addBtn.className = "btn";
      addBtn.textContent = unavailable ? "Out of stock" : "Add to Cart";
      addBtn.disabled = unavailable;
      addBtn.addEventListener("click", () => {
        cart.add(p.id, parseInt(qtyInput.value, 10) || 1);
        showToast(`${p.name} added to cart`);
      });

      const qtyRow = document.createElement("div");
      qtyRow.className = "qty-row";
      qtyRow.append(qtyInput, addBtn);

      const footer = document.createElement("div");
      footer.className = "product-footer";
      footer.appendChild(qtyRow);

      const body = document.createElement("div");
      body.className = "product-body";
      body.append(name, price, footer);

      const el = document.createElement("article");
      el.className = "product-card";
      el.append(thumb, body);

      return el;
    };

    grid.innerHTML = "";
    const fragment = document.createDocumentFragment();
    products.forEach((p) => fragment.appendChild(card(p)));
    grid.appendChild(fragment);
    renderEmptyState(grid, products);
  }

  function renderEmptyState(grid, products) {
    const existing = grid.parentElement.querySelector(".state-box");
    if (existing) existing.remove();
    if (products.length > 0) return;
    const box = document.createElement("div");
    box.className = "state-box";
    box.innerHTML = "<h2>No products yet</h2><p>Check back soon or visit the admin panel to add products.</p>";
    grid.parentElement.appendChild(box);
  }

  /* ----------------------------------------------------------
     Cart page: line items rendering
     ---------------------------------------------------------- */
  function renderCartPage() {
    const listEl = document.getElementById("cartItems");
    const summaryEl = document.getElementById("cartSummary");
    const root = listEl ? listEl.parentElement : null;
    if (!listEl) return;

    const items = cart.all();
    const ids = Object.keys(items);
    if (ids.length === 0) {
      listEl.innerHTML = "";
      document.getElementById("cartSummary").innerHTML =
        '<div class="state-box"><h2>Your cart is empty</h2><p><a href="index.html">Browse products</a> to get started.</p></div>';
      document.getElementById("cartSummary").style.display = "block";
      return;
    }

    loadProducts()
      .then((products) => {
        const map = Object.fromEntries(products.map((p) => [p.id, p]));
        let subtotal = 0;

        const rows = ids
          .map((id) => {
            const p = map[id];
            if (!p) return null;
            const qty = items[id];
            const line = p.price * qty;
            subtotal += line;
            return buildCartRow(p, qty, line);
          })
          .filter(Boolean);

        listEl.innerHTML = "";
        rows.forEach((row) => listEl.appendChild(row));

        document.getElementById("subtotal").textContent = formatPrice(subtotal);
        const checkoutBtn = document.getElementById("checkoutBtn");
        checkoutBtn.disabled = false;
        checkoutBtn.addEventListener("click", () => instagramCheckout(items, map));

        const clearBtn = document.getElementById("clearCartBtn");
        clearBtn.disabled = false;
        clearBtn.addEventListener("click", () => {
          cart.clear();
          location.reload();
        });
      })
      .catch((err) => {
        listEl.innerHTML = `<div class="state-box"><h2>Cart unavailable</h2><p>${err.message}</p></div>`;
      });
  }

  function buildCartRow(product, qty, line) {
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const img = document.createElement("img");
    img.src = product.image || CONFIG.DEFAULT_IMAGE;
    img.alt = product.name;
    thumb.appendChild(img);

    const name = document.createElement("h3");
    name.textContent = product.name;

    const price = document.createElement("div");
    price.className = "cart-item-price";
    price.textContent = `${formatPrice(product.price)} each`;

    const minus = document.createElement("button");
    minus.textContent = "−";
    minus.setAttribute("aria-label", "Decrease quantity");
    minus.addEventListener("click", () => {
      cart.setQuantity(product.id, qty - 1);
      renderCartPage();
    });

    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.setAttribute("aria-label", "Increase quantity");
    plus.addEventListener("click", () => {
      cart.setQuantity(product.id, qty + 1);
      renderCartPage();
    });

    const qtySpan = document.createElement("span");
    qtySpan.textContent = qty;

    const stepper = document.createElement("div");
    stepper.className = "qty-stepper";
    stepper.append(minus, qtySpan, plus);

    const info = document.createElement("div");
    info.className = "cart-item-info";
    info.append(name, price, stepper);

    const lineEl = document.createElement("div");
    lineEl.className = "cart-item-line";
    lineEl.textContent = formatPrice(line);

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-sm btn-danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      cart.remove(product.id);
      renderCartPage();
    });

    const actions = document.createElement("div");
    actions.className = "cart-item-actions";
    actions.append(lineEl, removeBtn);

    const row = document.createElement("div");
    row.className = "cart-item";
    row.append(thumb, info, actions);

    return row;
  }

  /* ----------------------------------------------------------
     Instagram checkout — builds message, copies to clipboard,
     opens Instagram DM.
     ---------------------------------------------------------- */
  async function instagramCheckout(items, productMap) {
    const lines = Object.entries(items).map(([id, qty]) => {
      const p = productMap[id];
      if (!p) return null;
      return `${p.name} x${qty} — ${formatPrice(p.price * qty)}`;
    }).filter(Boolean);

    const subtotal = Object.entries(items).reduce((sum, [id, qty]) => {
      const p = productMap[id];
      return p ? sum + p.price * qty : sum;
    }, 0);

    const message = [
      "Hi! I'd like to order:",
      "",
      ...lines.map((l, i) => `${i + 1}. ${l}`),
      "",
      `Total: ${formatPrice(subtotal)}`,
      "",
      "Thank you!",
    ].join("\n");

    try {
      await copyText(message);
      showToast("Order copied — paste it in Instagram DM", "success");
    } catch {
      showToast("Couldn't copy automatically — message is in a prompt below", "error");
    }
    window.open(IG_DM_URL, "_blank", "noopener,noreferrer");
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("clipboard fallback failed");
  }

  /* ----------------------------------------------------------
     Page-specific bootstrap
     ---------------------------------------------------------- */
  function initHome() {
    const grid = document.getElementById("productGrid");
    if (!grid) return;
    grid.innerHTML =
      '<div class="state-box"><div class="spinner"></div><p>Loading products…</p></div>';
    loadProducts()
      .then((products) => renderProducts(products))
      .catch((err) => {
        grid.innerHTML = `<div class="state-box"><h2>Couldn't load products</h2><p>${err.message}</p><p>Tip: open this site via GitHub Pages (https) or a local server.</p></div>`;
      });
  }

  function initCart() {
    if (!document.getElementById("cartItems")) return;
    renderCartPage();
  }

  function init() {
    updateCartCount();
    initHome();
    initCart();
  }

  document.addEventListener("DOMContentLoaded", init);

  return {
    CONFIG,
    IG_DM_URL,
    cart,
    overrides,
    loadProducts,
    mergeProducts,
    formatPrice,
    stockLabel,
    showToast,
    updateCartCount,
    renderProducts,
    renderCartPage,
  };
})();