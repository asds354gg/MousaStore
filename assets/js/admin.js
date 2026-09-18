/* ============================================================
   Mousa Store — admin.js
   Client-side password gate + product management.
   Changes persist to localStorage (a static host can't write
   to products.json) and are merged at load time by app.js.
   ============================================================ */
"use strict";

const AdminPanel = (() => {
  const CONFIG = MousaStore.CONFIG;

  const ADMIN_PASSWORD_HASH =
    "70049463ae4e4fa936b72b29bf35236cc69c106982034d8f35407d366242300f";

  /* ----------------------------------------------------------
     Auth
     ---------------------------------------------------------- */
  async function hashPassword(input) {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const isAuthenticated = () => sessionStorage.getItem(CONFIG.AUTH_KEY) === "1";

  function logout() {
    sessionStorage.removeItem(CONFIG.AUTH_KEY);
    location.href = "login.html";
  }

  /* ----------------------------------------------------------
     Base64 helpers (UTF-8 safe, unlike raw btoa/atob)
     ---------------------------------------------------------- */
  const utf8ToBase64 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  };

  const base64ToUtf8 = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };

  /* ----------------------------------------------------------
     GitHub REST API — commits changes straight to products.json
     in the repo, triggering a GitHub Pages rebuild.
       GET  /repos/{owner}/{repo}/contents/…  -> { sha, content }
       PUT  /repos/{owner}/{repo}/contents/…  -> { message, content, sha, branch }
     The current file's sha is required by GitHub to update a file.
     ---------------------------------------------------------- */
  const GitHubSync = {
    CONFIG_KEY: "mousa_store_github",
    FILE_PATH: "assets/data/products.json",

    readConfig() {
      try {
        return JSON.parse(localStorage.getItem(this.CONFIG_KEY)) || {};
      } catch {
        return {};
      }
    },

    saveConfig(cfg) {
      localStorage.setItem(this.CONFIG_KEY, JSON.stringify(cfg));
    },

    isConfigComplete(cfg) {
      return Boolean(cfg.token && cfg.owner && cfg.repo);
    },

    async request(config, endpoint, options = {}) {
      const res = await fetch(`https://api.github.com${endpoint}`, {
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
        body: options.body || null,
      });

      let data = null;
      try {
        data = await res.json();
      } catch {}

      if (!res.ok) {
        const error = new Error((data && data.message) || `HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
      return data;
    },

    async fetchFile(config) {
      const ref = config.branch
        ? `?ref=${encodeURIComponent(config.branch)}`
        : "";
      try {
        return await this.request(
          config,
          `/repos/${config.owner}/${config.repo}/contents/${this.FILE_PATH}${ref}`
        );
      } catch (err) {
        if (err.status === 404) return { sha: null, content: "" };
        throw err;
      }
    },

    async updateFile(config, sha, content, commitMessage) {
      const body = { message: commitMessage, content };
      if (sha) body.sha = sha;
      if (config.branch) body.branch = config.branch;
      return this.request(
        config,
        `/repos/${config.owner}/${config.repo}/contents/${this.FILE_PATH}`,
        { method: "PUT", body: JSON.stringify(body) }
      );
    },
  };

  /* ----------------------------------------------------------
     Pending-changes indicator
     ---------------------------------------------------------- */
  function pendingChangeCount() {
    const ovr = MousaStore.overrides.read();
    return (
      ovr.deleted.length +
      ovr.added.length +
      Object.keys(ovr.updates || {}).length
    );
  }

  /* ----------------------------------------------------------
     Login form
     ---------------------------------------------------------- */
  function initLogin() {
    const form = document.getElementById("loginForm");
    if (!form) return;

    if (isAuthenticated()) {
      location.replace("dashboard.html");
      return;
    }

    const field = document.getElementById("password");
    const error = document.getElementById("loginError");
    const button = form.querySelector("button");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      button.disabled = true;
      button.textContent = "Checking…";
      error.style.display = "none";

      const ok = (await hashPassword(field.value)) === ADMIN_PASSWORD_HASH;

      if (ok) {
        sessionStorage.setItem(CONFIG.AUTH_KEY, "1");
        location.href = "dashboard.html";
      } else {
        error.style.display = "block";
        field.value = "";
        field.focus();
        button.disabled = false;
        button.textContent = "Log In";
      }
    });
  }

  /* ----------------------------------------------------------
     Dashboard
     ---------------------------------------------------------- */
  function initDashboard() {
    const wrap = document.getElementById("dashboard");
    if (!wrap) return;

    if (!isAuthenticated()) {
      location.replace("login.html");
      return;
    }

    document.getElementById("logoutBtn").addEventListener("click", logout);

    loadDashboardProducts().catch(() => renderTable([]));

    const form = document.getElementById("addProductForm");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      addProduct();
    });

    document.getElementById("resetBtn").addEventListener("click", () => {
      MousaStore.overrides.clearAll();
      MousaStore.showToast("All admin changes reset to the base catalog", "success");
      MousaStore.loadProducts().then(renderTable);
    });

    document.getElementById("saveBtn").addEventListener("click", syncToGitHub);

    const ghForm = document.getElementById("githubSettingsForm");
    const cfg = GitHubSync.readConfig();
    ghForm.querySelector("#ghOwner").value = cfg.owner || "";
    ghForm.querySelector("#ghRepo").value = cfg.repo || "";
    ghForm.querySelector("#ghBranch").value = cfg.branch || "main";
    ghForm.querySelector("#ghToken").value = cfg.token || "";
    ghForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(ghForm);
      const next = {
        token: String(data.get("token") || "").trim(),
        owner: String(data.get("owner") || "").trim(),
        repo: String(data.get("repo") || "").trim(),
        branch: String(data.get("branch") || "").trim() || "main",
      };
      if (!next.token || !next.owner || !next.repo) {
        MousaStore.showToast("Token, username and repository are required", "error");
        return;
      }
      GitHubSync.saveConfig(next);
      MousaStore.showToast("GitHub credentials saved", "success");
    });
  }

  /* ----------------------------------------------------------
     Load initial dashboard data.
     Local view (products.json base + pending overrides) wins
     when it has anything; otherwise fall back to the current
     file stored in the GitHub repo via the saved credentials.
     ---------------------------------------------------------- */
  async function loadDashboardProducts() {
    const localProducts = await MousaStore.loadProducts();
    if (localProducts.length > 0) {
      renderTable(localProducts);
      return;
    }

    const config = GitHubSync.readConfig();
    if (!GitHubSync.isConfigComplete(config)) {
      renderTable(localProducts);
      return;
    }

    try {
      const remote = await GitHubSync.fetchFile(config);
      const remoteProducts = remote.content
        ? JSON.parse(base64ToUtf8(remote.content))
        : [];
      renderTable(MousaStore.mergeProducts(remoteProducts));
    } catch {
      renderTable(localProducts);
    }
  }

  /* ----------------------------------------------------------
     Save Changes — push the merged catalog to GitHub
     ---------------------------------------------------------- */
  function setSyncState(state, message) {
    const btn = document.getElementById("saveBtn");
    const status = document.getElementById("syncStatus");
    if (state === "saving") {
      btn.disabled = true;
      btn.textContent = "Saving…";
      status.textContent = message;
      status.style.color = "var(--text-muted)";
    } else if (state === "done") {
      btn.disabled = false;
      btn.textContent = "Save Changes to GitHub";
      status.textContent = message;
      status.style.color = "var(--success)";
    } else {
      btn.disabled = false;
      btn.textContent = "Save Changes to GitHub";
      status.textContent = "";
    }
  }

  async function syncToGitHub() {
    const config = GitHubSync.readConfig();
    if (!GitHubSync.isConfigComplete(config)) {
      MousaStore.showToast("Set GitHub credentials in the settings section first", "error");
      setSyncState("idle");
      return;
    }

    setSyncState("saving", "Fetching current products.json from GitHub…");

    try {
      const remote = await GitHubSync.fetchFile(config);
      const remoteProducts = remote.content
        ? JSON.parse(base64ToUtf8(remote.content))
        : [];

      const finalProducts = MousaStore.mergeProducts(remoteProducts);
      const encoded = utf8ToBase64(JSON.stringify(finalProducts, null, 2));

      setSyncState("saving", "Committing to GitHub…");
      await GitHubSync.updateFile(
        config,
        remote.sha,
        encoded,
        "Update products.json via Admin Panel"
      );

      MousaStore.overrides.clearAll();
      renderTable(finalProducts);
      setSyncState("done", "Saved. GitHub Pages will rebuild automatically.");
      MousaStore.showToast("products.json pushed to GitHub — rebuild started", "success");
    } catch (err) {
      setSyncState("idle");
      MousaStore.showToast(`Sync failed: ${err.message}`, "error");
    }
  }

  /* ----------------------------------------------------------
     Table rendering
     ---------------------------------------------------------- */
  let currentProducts = [];

  function renderTable(products) {
    currentProducts = products;
    const tbody = document.getElementById("productsBody");
    if (!tbody) return;

    const countEl = document.getElementById("productCount");
    if (countEl) countEl.textContent = `(${products.length})`;

    const pending = pendingChangeCount();
    const pendingEl = document.getElementById("pendingCount");
    if (pendingEl) {
      pendingEl.textContent = pending ? `${pending} pending change${pending > 1 ? "s" : ""}` : "";
      pendingEl.style.display = pending ? "inline-block" : "none";
    }

    tbody.innerHTML = "";
    products.forEach((p) => {
      const tr = document.createElement("tr");

      const thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.src = p.image || CONFIG.DEFAULT_IMAGE;
      thumb.alt = p.name;

      const tdThumb = document.createElement("td");
      tdThumb.appendChild(thumb);

      const tdName = document.createElement("td");
      tdName.textContent = p.name;
      tdName.style.fontWeight = "700";

      const tdPrice = document.createElement("td");
      tdPrice.textContent = MousaStore.formatPrice(p.price);

      const tdStock = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `badge-status ${p.stock}`;
      badge.textContent = MousaStore.stockLabel(p.stock);
      tdStock.appendChild(badge);

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "btn btn-sm btn-secondary";
      toggleBtn.textContent =
        p.stock === "out-of-stock" ? "Mark in stock" : "Mark out of stock";
      toggleBtn.addEventListener("click", () => {
        const next = p.stock === "out-of-stock" ? "in-stock" : "out-of-stock";
        MousaStore.overrides.setStock(p.id, next);
        MousaStore.loadProducts().then(renderTable);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn btn-sm btn-danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`Delete "${p.name}"?`)) return;
        MousaStore.overrides.deleteProduct(p.id);
        MousaStore.showToast(`${p.name} deleted`, "success");
        MousaStore.loadProducts().then(renderTable);
      });

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-sm btn-secondary";
      editBtn.textContent = "Edit";
      editBtn.dataset.action = "edit";
      editBtn.dataset.id = p.id;

      const tdActions = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "cell-actions";
      actions.append(editBtn, toggleBtn, deleteBtn);
      tdActions.appendChild(actions);

      tr.append(tdThumb, tdName, tdPrice, tdStock, tdActions);
      tbody.appendChild(tr);
    });
  }

  /* ----------------------------------------------------------
     Create product
     ---------------------------------------------------------- */
  function addProduct() {
    const form = document.getElementById("addProductForm");
    const data = new FormData(form);

    const name = String(data.get("name") || "").trim();
    const price = parseFloat(data.get("price"));
    const image = String(data.get("image") || "").trim();
    const stock = data.get("stock") === "in-stock" ? "in-stock" : "out-of-stock";

    if (!name) {
      MousaStore.showToast("Product name is required", "error");
      return;
    }
    if (!(price >= 0) || Number.isNaN(price)) {
      MousaStore.showToast("Enter a valid price", "error");
      return;
    }

    const product = {
      id: `prod-${Date.now().toString(36)}`,
      name,
      price,
      image: image || CONFIG.DEFAULT_IMAGE,
      stock,
    };

    MousaStore.overrides.addProduct(product);
    MousaStore.showToast(`"${name}" added`, "success");
    form.reset();
    MousaStore.loadProducts().then(renderTable);
  }

  /* ----------------------------------------------------------
     Edit product modal
     ---------------------------------------------------------- */
  function openEditModal(productId) {
    const product = currentProducts.find((p) => p.id === productId);
    if (!product) {
      MousaStore.showToast("Product not found", "error");
      return;
    }

    document.getElementById("editProductId").value = product.id;
    document.getElementById("editName").value = product.name;
    document.getElementById("editPrice").value = product.price;
    document.getElementById("editImage").value = product.image || "";

    const inStock = document.getElementById("editStockIn");
    const outOfStock = document.getElementById("editStockOut");
    inStock.checked = product.stock !== "out-of-stock";
    outOfStock.checked = product.stock === "out-of-stock";

    document.getElementById("editModal").classList.add("open");
  }

  function saveEditedProduct() {
    const id = document.getElementById("editProductId").value;
    const name = document.getElementById("editName").value.trim();
    const price = parseFloat(document.getElementById("editPrice").value);
    const image = document.getElementById("editImage").value.trim();
    const stock = document.getElementById("editStockIn").checked
      ? "in-stock"
      : "out-of-stock";

    if (!name) {
      MousaStore.showToast("Product name is required", "error");
      return;
    }
    if (!(price >= 0) || Number.isNaN(price)) {
      MousaStore.showToast("Enter a valid price", "error");
      return;
    }

    MousaStore.overrides.updateProduct(id, {
      name,
      price,
      image: image || CONFIG.DEFAULT_IMAGE,
      stock,
    });
    MousaStore.showToast(`"${name}" updated`, "success");
    document.getElementById("editModal").classList.remove("open");
    MousaStore.loadProducts().then(renderTable);
  }

  function initEditModal() {
    const modal = document.getElementById("editModal");
    if (!modal) return;

    const close = () => {
      modal.classList.remove("open");
      modal.querySelector("form").reset();
    };

    modal.querySelector(".modal-close").addEventListener("click", close);
    modal.querySelector(".modal-cancel").addEventListener("click", close);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("open")) close();
    });

    document.getElementById("editProductForm").addEventListener("submit", (e) => {
      e.preventDefault();
      saveEditedProduct();
    });

    document.getElementById("productsBody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action='edit']");
      if (btn) openEditModal(btn.dataset.id);
    });
  }

  /* ----------------------------------------------------------
     Bootstrap the active page
     ---------------------------------------------------------- */
  function init() {
    initLogin();
    initEditModal();
    initDashboard();
  }

  document.addEventListener("DOMContentLoaded", init);

  return { isAuthenticated, logout };
})();