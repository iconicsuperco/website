import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Copy,
  CreditCard,
  Edit3,
  ExternalLink,
  Eye,
  Gauge,
  Headphones,
  ImagePlus,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  Minus,
  Package,
  PackageCheck,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Upload,
  X,
} from "lucide-react";
import {
  adminLogin,
  adminLogout,
  archiveAdminProduct,
  checkAdminSession,
  getAdminDashboard,
  getAdminOrders,
  getAdminProducts,
  getAdminSettings,
  saveAdminProduct,
  saveAdminSettings,
  updateAdminOrder,
  uploadAdminImage,
} from "../services/admin";
import "./admin.css";

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

const STATUS_OPTIONS = [
  "payment_pending",
  "paid",
  "cod_confirmed",
  "shipment_pending",
  "shipment_created",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];

const ACTION_ORDER_STATUSES = new Set([
  "paid",
  "cod_confirmed",
  "shipment_pending",
  "shipment_created",
  "processing",
]);

const COMPLETED_ORDER_STATUSES = new Set(["shipped", "delivered"]);
const CLOSED_ORDER_STATUSES = new Set(["cancelled", "refunded"]);

const statusLabel = (status = "") =>
  status
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");

const EMPTY_PRODUCT = {
  name: "",
  asin: "",
  category: "Stickers & labels",
  price: "",
  mrp: "",
  inventory: "0",
  image: "",
  badge: "New",
  short: "",
  highlights: "",
  specs: "",
  featured: false,
  active: true,
};

function AdminApp() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAdminSession()
      .then((result) => setAuthenticated(result.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <AdminBoot />;
  if (!authenticated) {
    return <AdminLogin onAuthenticated={() => setAuthenticated(true)} />;
  }
  return <AdminShell onSignedOut={() => setAuthenticated(false)} />;
}

function AdminBoot() {
  return (
    <div className="admin-boot">
      <span>
        <LoaderCircle size={25} />
      </span>
      <img src="/brand/kelenate-logo.jpeg" alt="Kelenate" />
      <p>Opening store control…</p>
    </div>
  );
}

function AdminLogin({ onAuthenticated }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminLogin(password);
      onAuthenticated();
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-login">
      <section className="admin-login__brand">
        <a href="/" aria-label="Return to Kelenate store">
          <ArrowLeft size={17} /> Back to store
        </a>
        <div>
          <span className="admin-login__mark">
            <Gauge size={31} />
          </span>
          <p>Kelenate commerce</p>
          <h1>One place to run the whole store.</h1>
          <ul>
            <li>
              <Check size={17} /> See and process every customer order
            </li>
            <li>
              <Check size={17} /> Add products, images, pricing and inventory
            </li>
            <li>
              <Check size={17} /> Monitor payment and courier readiness
            </li>
          </ul>
        </div>
      </section>
      <section className="admin-login__form-wrap">
        <form className="admin-login__form" onSubmit={submit}>
          <span className="admin-login__logo">
            <img src="/brand/kelenate-logo.jpeg" alt="Kelenate" />
          </span>
          <p className="admin-kicker">Private administration</p>
          <h2>Welcome back.</h2>
          <p>Enter the administrator password to continue.</p>
          <label>
            <span>Admin password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoFocus
              autoComplete="current-password"
              placeholder="••••••••••••"
            />
          </label>
          {error && <div className="admin-error">{error}</div>}
          <button className="admin-primary-btn" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={19} /> : <ShieldCheck size={19} />}
            {busy ? "Signing in…" : "Open control panel"}
          </button>
          <small>
            Local preview password: <strong>kelenate-admin</strong>. Set a
            private password in <code>.env</code> before deployment.
          </small>
        </form>
      </section>
    </main>
  );
}

function AdminShell({ onSignedOut }) {
  const [section, setSection] = useState("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [productEditor, setProductEditor] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [archiveCandidate, setArchiveCandidate] = useState(null);

  const loadData = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [dashboardResult, orderResult, productResult, settingsResult] =
        await Promise.all([
          getAdminDashboard(),
          getAdminOrders(),
          getAdminProducts(),
          getAdminSettings(),
        ]);
      setDashboard(dashboardResult);
      setOrders(orderResult.orders);
      setProducts(productResult.products);
      setCategories(productResult.categories);
      setSettings(settingsResult);
    } catch (loadError) {
      if (loadError.status === 401) {
        onSignedOut();
        return;
      }
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onSignedOut]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const overlayOpen =
      mobileNav || productEditor || selectedOrder || archiveCandidate;
    if (!overlayOpen) return undefined;

    document.body.classList.add("admin-overlay-open");
    return () => document.body.classList.remove("admin-overlay-open");
  }, [archiveCandidate, mobileNav, productEditor, selectedOrder]);

  const navigate = (nextSection) => {
    setSection(nextSection);
    setMobileNav(false);
  };

  const signOut = async () => {
    await adminLogout().catch(() => null);
    onSignedOut();
  };

  const updateOrder = async (orderId, status) => {
    const result = await updateAdminOrder(orderId, status);
    setOrders((current) =>
      current.map((order) => (order.orderId === orderId ? result.order : order)),
    );
    setSelectedOrder(result.order);
    setToast(`Order ${orderId} updated`);
    await loadData(true);
  };

  const saveProduct = async (product, productId) => {
    const result = await saveAdminProduct(product, productId);
    setProductEditor(null);
    setToast(productId ? "Product updated" : "Product added to the store");
    await loadData(true);
    return result.product;
  };

  const archiveProduct = async (product) => {
    await archiveAdminProduct(product.id);
    setArchiveCandidate(null);
    setToast("Product removed from the storefront");
    await loadData(true);
  };

  const updateProductFields = async (product, changes, message) => {
    const result = await saveAdminProduct(
      { ...product, ...changes },
      product.id,
    );
    setProducts((current) =>
      current.map((item) => (item.id === product.id ? result.product : item)),
    );
    setToast(message);
    await loadData(true);
    return result.product;
  };

  const updateSettings = async (nextSettings) => {
    const result = await saveAdminSettings(nextSettings);
    setSettings(result);
    setToast("Store settings saved");
    return result;
  };

  return (
    <div className="admin-shell">
      <AdminSidebar
        section={section}
        navigate={navigate}
        mobileNav={mobileNav}
        closeMobile={() => setMobileNav(false)}
        signOut={signOut}
      />
      <main className="admin-main">
        <AdminTopbar
          section={section}
          openMenu={() => setMobileNav(true)}
          refresh={() => loadData(true)}
          refreshing={refreshing}
        />
        <div className="admin-page">
          {error && (
            <div className="admin-page-error">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button type="button" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <AdminLoading />
          ) : (
            <>
              {section === "overview" && (
                <Overview
                  dashboard={dashboard}
                  openOrder={(order) => setSelectedOrder(order)}
                  goTo={navigate}
                />
              )}
              {section === "orders" && (
                <Orders
                  orders={orders}
                  openOrder={(order) => setSelectedOrder(order)}
                />
              )}
              {section === "products" && (
                <Products
                  products={products}
                  addProduct={() => setProductEditor({ product: null })}
                  editProduct={(product) => setProductEditor({ product })}
                  archiveProduct={setArchiveCandidate}
                  restoreProduct={(product) =>
                    updateProductFields(
                      product,
                      { active: true },
                      `${product.name} restored to the storefront`,
                    )
                  }
                  updateInventory={(product, inventory) =>
                    updateProductFields(
                      product,
                      { inventory },
                      `${product.name} inventory updated`,
                    )
                  }
                />
              )}
              {section === "settings" && (
                <StoreSettings settings={settings} save={updateSettings} />
              )}
            </>
          )}
        </div>
      </main>

      {productEditor && (
        <ProductEditor
          product={productEditor.product}
          categories={categories}
          close={() => setProductEditor(null)}
          save={saveProduct}
        />
      )}
      {selectedOrder && (
        <OrderDetail
          order={selectedOrder}
          close={() => setSelectedOrder(null)}
          update={updateOrder}
        />
      )}
      {archiveCandidate && (
        <ArchiveConfirmation
          product={archiveCandidate}
          close={() => setArchiveCandidate(null)}
          confirm={archiveProduct}
        />
      )}
      {toast && (
        <div className="admin-toast">
          <Check size={17} /> {toast}
        </div>
      )}
    </div>
  );
}

const NAV_ITEMS = [
  ["overview", LayoutDashboard, "Overview"],
  ["orders", ShoppingCart, "Orders"],
  ["products", Package, "Products"],
  ["settings", Settings, "Store settings"],
];

function AdminSidebar({
  section,
  navigate,
  mobileNav,
  closeMobile,
  signOut,
}) {
  return (
    <>
      {mobileNav && (
        <button
          className="admin-nav-overlay"
          type="button"
          aria-label="Close navigation"
          onClick={closeMobile}
        />
      )}
      <aside className={`admin-sidebar ${mobileNav ? "admin-sidebar--open" : ""}`}>
        <div className="admin-sidebar__head">
          <a href="/" className="admin-sidebar__logo">
            <img src="/brand/kelenate-logo.jpeg" alt="Kelenate" />
          </a>
          <button type="button" onClick={closeMobile} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>
        <div className="admin-store-pill">
          <span>K</span>
          <p>
            <strong>Kelenate Store</strong>
            <small>Direct commerce</small>
          </p>
          <span className="admin-live-dot">Live</span>
        </div>
        <nav aria-label="Admin navigation">
          <p>Workspace</p>
          {NAV_ITEMS.map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              className={section === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {section === id && <ChevronRight size={16} />}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar__bottom">
          <a href="/" target="_blank">
            <ExternalLink size={17} /> View storefront
          </a>
          <button type="button" onClick={signOut}>
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

function AdminTopbar({ section, openMenu, refresh, refreshing }) {
  const item = NAV_ITEMS.find(([id]) => id === section);
  return (
    <header className="admin-topbar">
      <button
        className="admin-menu-btn"
        type="button"
        onClick={openMenu}
        aria-label="Open navigation"
      >
        <Menu size={22} />
      </button>
      <div>
        <p>Store control</p>
        <h1>{item?.[2] || "Overview"}</h1>
      </div>
      <div className="admin-topbar__actions">
        <button type="button" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? "spin" : ""} size={17} />
          <span>Refresh</span>
        </button>
        <span className="admin-avatar">AG</span>
      </div>
    </header>
  );
}

function AdminLoading() {
  return (
    <div className="admin-loading">
      <LoaderCircle className="spin" size={27} />
      <p>Loading current store data…</p>
    </div>
  );
}

function Overview({ dashboard, openOrder, goTo }) {
  const metrics = dashboard?.metrics || {};
  const cards = [
    ["Total orders", metrics.totalOrders, ShoppingCart, "navy"],
    ["Recorded revenue", formatCurrency(metrics.revenue), CircleDollarSign, "green"],
    ["Orders to action", metrics.pendingOrders, Truck, "orange"],
    ["Active products", metrics.activeProducts, Boxes, "blue"],
  ];
  return (
    <div className="admin-section">
      <div className="admin-welcome">
        <div>
          <p className="admin-kicker">Today’s workspace</p>
          <h2>Good to see you.</h2>
          <p>Here’s what needs attention across Kelenate right now.</p>
        </div>
        <button type="button" onClick={() => goTo("products")}>
          <Plus size={18} /> Add a product
        </button>
      </div>
      <div className="admin-metrics">
        {cards.map(([label, value, Icon, tone]) => (
          <article className={`admin-metric admin-metric--${tone}`} key={label}>
            <span>
              <Icon size={21} />
            </span>
            <p>{label}</p>
            <strong>{value ?? 0}</strong>
          </article>
        ))}
      </div>
      <div className="admin-overview-grid">
        <section className="admin-panel admin-recent">
          <div className="admin-panel__head">
            <div>
              <p className="admin-kicker">Latest activity</p>
              <h3>Recent orders</h3>
            </div>
            <button type="button" onClick={() => goTo("orders")}>
              View all <ChevronRight size={16} />
            </button>
          </div>
          {dashboard?.recentOrders?.length ? (
            <div className="admin-mini-orders">
              {dashboard.recentOrders.map((order) => (
                <button
                  type="button"
                  key={order.orderId}
                  onClick={() => openOrder(order)}
                >
                  <span className="admin-order-icon">
                    <Package size={18} />
                  </span>
                  <p>
                    <strong>{order.orderId}</strong>
                    <small>{order.customer?.name || "Customer"} · {formatDate(order.createdAt)}</small>
                  </p>
                  <StatusPill status={order.status} />
                  <b>{formatCurrency(order.total)}</b>
                </button>
              ))}
            </div>
          ) : (
            <AdminEmpty
              icon={ShoppingCart}
              title="No orders yet"
              copy="New website orders will appear here automatically."
            />
          )}
        </section>
        <section className="admin-panel admin-readiness">
          <div className="admin-panel__head">
            <div>
              <p className="admin-kicker">Launch checklist</p>
              <h3>Commerce readiness</h3>
            </div>
          </div>
          <ReadinessRow
            icon={CreditCard}
            label="Razorpay payments"
            ready={dashboard?.integrations?.razorpay}
          />
          <ReadinessRow
            icon={Truck}
            label="Shiprocket account"
            ready={dashboard?.integrations?.shiprocket}
          />
          <ReadinessRow
            icon={Boxes}
            label="Parcel measurements"
            ready={dashboard?.integrations?.measurements}
          />
          <div className="admin-stock-alert">
            <AlertTriangle size={18} />
            <p>
              <strong>{dashboard?.metrics?.lowStock || 0} low-stock products</strong>
              Inventory at five units or fewer needs attention.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function ReadinessRow({ icon: Icon, label, ready }) {
  return (
    <div className="admin-readiness-row">
      <span>
        <Icon size={18} />
      </span>
      <p>
        <strong>{label}</strong>
        <small>{ready ? "Connected and ready" : "Setup still required"}</small>
      </p>
      <i className={ready ? "ready" : ""}>{ready ? "Ready" : "Pending"}</i>
    </div>
  );
}

function Orders({ orders, openOrder }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const counts = useMemo(
    () => ({
      all: orders.length,
      action: orders.filter((order) => ACTION_ORDER_STATUSES.has(order.status))
        .length,
      completed: orders.filter((order) =>
        COMPLETED_ORDER_STATUSES.has(order.status),
      ).length,
      closed: orders.filter((order) => CLOSED_ORDER_STATUSES.has(order.status))
        .length,
    }),
    [orders],
  );
  const filtered = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    return orders.filter((order) => {
      const matchesStatus =
        status === "all" ||
        order.status === status ||
        (status === "action" && ACTION_ORDER_STATUSES.has(order.status)) ||
        (status === "completed" &&
          COMPLETED_ORDER_STATUSES.has(order.status)) ||
        (status === "closed" && CLOSED_ORDER_STATUSES.has(order.status));
      const matchesQuery =
        !normalized ||
        [
          order.orderId,
          order.customer?.name,
          order.customer?.phone,
          order.customer?.email,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return matchesStatus && matchesQuery;
    });
  }, [orders, query, status]);

  return (
    <div className="admin-section">
      <SectionIntro
        title="Orders"
        copy="Review customer details, payment type, totals and fulfilment status."
      />
      <div className="admin-order-summary" aria-label="Order status summary">
        {[
          ["all", ShoppingCart, "All orders", counts.all],
          ["action", Truck, "Needs action", counts.action],
          ["completed", CheckCircle2, "On the way / done", counts.completed],
          ["closed", Archive, "Closed", counts.closed],
        ].map(([id, Icon, label, count]) => (
          <button
            key={id}
            type="button"
            className={status === id ? "active" : ""}
            onClick={() => setStatus(id)}
          >
            <span>
              <Icon size={17} />
            </span>
            <p>
              <small>{label}</small>
              <strong>{count}</strong>
            </p>
          </button>
        ))}
      </div>
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ID, customer or phone"
          />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="action">Needs action</option>
          <option value="completed">On the way / completed</option>
          <option value="closed">Cancelled / refunded</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {statusLabel(option)}
            </option>
          ))}
        </select>
      </div>
      <section className="admin-panel admin-table-wrap">
        {filtered.length ? (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Total</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.orderId}>
                  <td>
                    <strong>{order.orderId}</strong>
                    <small>{formatDate(order.createdAt)}</small>
                  </td>
                  <td>
                    <strong>{order.customer?.name || "Customer"}</strong>
                    <small>{order.customer?.phone}</small>
                  </td>
                  <td>{order.paymentMethod === "cod" ? "Cash on delivery" : "Online"}</td>
                  <td><StatusPill status={order.status} /></td>
                  <td><strong>{formatCurrency(order.total)}</strong></td>
                  <td>
                    <button type="button" onClick={() => openOrder(order)} aria-label={`View ${order.orderId}`}>
                      <Eye size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <AdminEmpty
            icon={ShoppingCart}
            title={orders.length ? "No matching orders" : "No orders yet"}
            copy={
              orders.length
                ? "Try a different search or status filter."
                : "Orders will appear as customers check out."
            }
          />
        )}
      </section>
    </div>
  );
}

function Products({
  products,
  addProduct,
  editProduct,
  archiveProduct,
  restoreProduct,
  updateInventory,
}) {
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState("active");
  const [stock, setStock] = useState("all");
  const [busyProduct, setBusyProduct] = useState("");
  const [error, setError] = useState("");
  const counts = useMemo(
    () => ({
      active: products.filter((product) => product.active !== false).length,
      archived: products.filter((product) => product.active === false).length,
      low: products.filter(
        (product) =>
          product.active !== false &&
          Number(product.inventory || 0) > 0 &&
          Number(product.inventory || 0) <= 5,
      ).length,
      out: products.filter(
        (product) =>
          product.active !== false && Number(product.inventory || 0) === 0,
      ).length,
    }),
    [products],
  );
  const filtered = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    return products.filter((product) => {
      const matchesVisibility =
        visibility === "all" ||
        (visibility === "active" && product.active !== false) ||
        (visibility === "archived" && product.active === false);
      const inventory = Number(product.inventory || 0);
      const matchesStock =
        stock === "all" ||
        (stock === "in" && inventory > 5) ||
        (stock === "low" && inventory > 0 && inventory <= 5) ||
        (stock === "out" && inventory === 0);
      return (
        matchesVisibility &&
        matchesStock &&
        (!normalized ||
          [product.name, product.asin, product.category]
            .join(" ")
            .toLowerCase()
            .includes(normalized))
      );
    });
  }, [products, query, visibility, stock]);

  const changeInventory = async (product, nextInventory) => {
    if (busyProduct || nextInventory < 0) return;
    setBusyProduct(product.id);
    setError("");
    try {
      await updateInventory(product, nextInventory);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusyProduct("");
    }
  };

  const restore = async (product) => {
    if (busyProduct) return;
    setBusyProduct(product.id);
    setError("");
    try {
      await restoreProduct(product);
    } catch (restoreError) {
      setError(restoreError.message);
    } finally {
      setBusyProduct("");
    }
  };

  return (
    <div className="admin-section">
      <SectionIntro
        title="Products"
        copy="Control storefront details, pricing, availability and stock."
        action={
          <button className="admin-primary-btn" type="button" onClick={addProduct}>
            <Plus size={18} /> Add product
          </button>
        }
      />
      <div className="admin-catalog-health" aria-label="Catalog health">
        {[
          ["active", PackageCheck, "Active", counts.active],
          ["archived", Archive, "Archived", counts.archived],
          ["low", AlertTriangle, "Low stock", counts.low],
          ["out", Boxes, "Out of stock", counts.out],
        ].map(([id, Icon, label, count]) => (
          <button
            key={id}
            type="button"
            className={
              (id === "active" && visibility === "active" && stock === "all") ||
              (id === "archived" && visibility === "archived") ||
              (id === "low" && stock === "low") ||
              (id === "out" && stock === "out")
                ? "active"
                : ""
            }
            onClick={() => {
              if (id === "archived") {
                setVisibility("archived");
                setStock("all");
              } else {
                setVisibility("active");
                setStock(id === "active" ? "all" : id);
              }
            }}
          >
            <span>
              <Icon size={17} />
            </span>
            <p>
              <small>{label}</small>
              <strong>{count}</strong>
            </p>
          </button>
        ))}
      </div>
      {error && (
        <div className="admin-page-error admin-product-error">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, ASIN or category"
          />
        </label>
        <div className="admin-toolbar__filters">
          <select
            value={visibility}
            onChange={(event) => setVisibility(event.target.value)}
            aria-label="Filter product visibility"
          >
            <option value="active">Active products</option>
            <option value="archived">Archived products</option>
            <option value="all">All products</option>
          </select>
          <select
            value={stock}
            onChange={(event) => setStock(event.target.value)}
            aria-label="Filter product inventory"
          >
            <option value="all">Any stock level</option>
            <option value="in">Healthy stock · 6+</option>
            <option value="low">Low stock · 1–5</option>
            <option value="out">Out of stock</option>
          </select>
        </div>
      </div>
      <div className="admin-product-grid">
        {filtered.map((product) => (
          <article
            className={`admin-product-card ${product.active === false ? "is-archived" : ""}`}
            key={product.id}
          >
            <div className="admin-product-card__image">
              <img src={product.image} alt="" />
              <span>{product.active === false ? "Archived" : product.badge}</span>
              {product.active !== false && (
                <a
                  href={`/products/${encodeURIComponent(product.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`View ${product.name} on the storefront`}
                >
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
            <div className="admin-product-card__copy">
              <p>{product.category}</p>
              <h3>{product.name}</h3>
              <small>{product.asin || "No ASIN"}</small>
              <div className="admin-product-card__numbers">
                <span>
                  <small>Price</small>
                  <strong>{formatCurrency(product.price)}</strong>
                </span>
                <span className={Number(product.inventory || 0) <= 5 ? "low" : ""}>
                  <small>Inventory</small>
                  <div className="admin-stock-stepper">
                    <button
                      type="button"
                      onClick={() =>
                        changeInventory(
                          product,
                          Number(product.inventory || 0) - 1,
                        )
                      }
                      disabled={
                        busyProduct === product.id ||
                        Number(product.inventory || 0) <= 0
                      }
                      aria-label={`Decrease ${product.name} inventory`}
                    >
                      <Minus size={13} />
                    </button>
                    <strong>
                      {busyProduct === product.id ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        product.inventory ?? 0
                      )}
                    </strong>
                    <button
                      type="button"
                      onClick={() =>
                        changeInventory(
                          product,
                          Number(product.inventory || 0) + 1,
                        )
                      }
                      disabled={busyProduct === product.id}
                      aria-label={`Increase ${product.name} inventory`}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </span>
              </div>
              <div className="admin-product-card__actions">
                <button type="button" onClick={() => editProduct(product)}>
                  <Edit3 size={16} /> Edit product
                </button>
                {product.active !== false && (
                  <button type="button" onClick={() => archiveProduct(product)}>
                    <Archive size={16} />
                    <span>Remove</span>
                  </button>
                )}
                {product.active === false && (
                  <button
                    className="restore"
                    type="button"
                    onClick={() => restore(product)}
                    disabled={busyProduct === product.id}
                  >
                    {busyProduct === product.id ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <RotateCcw size={16} />
                    )}
                    <span>Restore</span>
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
        {!filtered.length && (
          <div className="admin-panel admin-products-empty">
            <AdminEmpty
              icon={Package}
              title="No products match"
              copy="Try another search or visibility filter."
            />
          </div>
        )}
      </div>
    </div>
  );
}

const editableSettings = (settings = {}) => ({
  freeThreshold: String(settings.shipping?.freeThreshold ?? 500),
  standardFee: String(settings.shipping?.standardFee ?? 49),
  phone: settings.support?.phone || "",
  whatsapp: settings.support?.whatsapp || "",
  email: settings.support?.email || "",
  hours: settings.support?.hours || "",
  returnWindowDays: String(settings.returns?.windowDays ?? 7),
});

function StoreSettings({ settings, save }) {
  const [form, setForm] = useState(() => editableSettings(settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(editableSettings(settings));
  }, [settings]);

  const change = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await save({
        shipping: {
          freeThreshold: Number(form.freeThreshold),
          standardFee: Number(form.standardFee),
        },
        support: {
          phone: form.phone,
          whatsapp: form.whatsapp,
          email: form.email,
          hours: form.hours,
        },
        returns: {
          windowDays: Number(form.returnWindowDays),
        },
      });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="admin-section admin-settings-form" onSubmit={submit}>
      <SectionIntro
        title="Store settings"
        copy="Control the delivery and support information customers see across the store."
        action={
          <button className="admin-primary-btn" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Save size={18} />
            )}
            {busy ? "Saving…" : "Save settings"}
          </button>
        }
      />
      {error && <div className="admin-settings-error">{error}</div>}
      <div className="admin-settings-grid">
        <section className="admin-panel">
          <div className="admin-panel__head">
            <div>
              <p className="admin-kicker">Delivery</p>
              <h3>Shipping rules</h3>
            </div>
            <Truck size={21} />
          </div>
          <div className="admin-settings-fields">
            <AdminField label="Free shipping from (₹)">
              <input
                type="number"
                min="0"
                max="100000"
                step="1"
                value={form.freeThreshold}
                onChange={(event) => change("freeThreshold", event.target.value)}
                required
              />
            </AdminField>
            <AdminField label="Shipping charge below threshold (₹)">
              <input
                type="number"
                min="0"
                max="10000"
                step="1"
                value={form.standardFee}
                onChange={(event) => change("standardFee", event.target.value)}
                required
              />
            </AdminField>
          </div>
          <div className="admin-settings-preview">
            <Truck size={17} />
            <span>
              Orders from <strong>{formatCurrency(form.freeThreshold)}</strong>{" "}
              ship free; smaller orders pay{" "}
              <strong>{formatCurrency(form.standardFee)}</strong>.
            </span>
          </div>
          <p className="admin-setting-note">
            Saving changes the cart display and server-side checkout pricing.
          </p>
        </section>
        <section className="admin-panel">
          <div className="admin-panel__head">
            <div>
              <p className="admin-kicker">Customer care</p>
              <h3>Support details</h3>
            </div>
            <Headphones size={21} />
          </div>
          <div className="admin-settings-fields">
            <AdminField label="Displayed phone number">
              <input
                value={form.phone}
                onChange={(event) => change("phone", event.target.value)}
                placeholder="+91 98991 07642"
                required
              />
            </AdminField>
            <AdminField label="WhatsApp number (with country code)">
              <input
                value={form.whatsapp}
                onChange={(event) => change("whatsapp", event.target.value)}
                inputMode="numeric"
                placeholder="919899107642"
                required
              />
            </AdminField>
            <AdminField label="Support email">
              <input
                type="email"
                value={form.email}
                onChange={(event) => change("email", event.target.value)}
                required
              />
            </AdminField>
            <AdminField label="Support hours">
              <input
                value={form.hours}
                onChange={(event) => change("hours", event.target.value)}
                required
              />
            </AdminField>
            <AdminField label="Return window (days)">
              <input
                type="number"
                min="1"
                max="30"
                step="1"
                value={form.returnWindowDays}
                onChange={(event) =>
                  change("returnWindowDays", event.target.value)
                }
                required
              />
            </AdminField>
          </div>
          <p className="admin-setting-note">
            These details appear in support links, policies and customer-facing
            reassurance messages.
          </p>
        </section>
        <section className="admin-panel">
          <div className="admin-panel__head">
            <div>
              <p className="admin-kicker">Connections</p>
              <h3>Payment & courier</h3>
            </div>
            <ShieldCheck size={21} />
          </div>
          <ReadinessRow
            icon={CreditCard}
            label="Razorpay"
            ready={settings?.integrations?.razorpay}
          />
          <ReadinessRow
            icon={Truck}
            label="Shiprocket"
            ready={settings?.integrations?.shiprocket}
          />
        </section>
        <section className="admin-panel admin-settings-wide">
          <div className="admin-panel__head">
            <div>
              <p className="admin-kicker">Catalog</p>
              <h3>Active categories</h3>
            </div>
            <Boxes size={21} />
          </div>
          <div className="admin-category-list">
            {settings?.categories?.map((category) => (
              <span key={category}>{category}</span>
            ))}
          </div>
          <p className="admin-setting-note">
            Product inventory and images can be changed from the Products page.
            Category management and CSV bulk import are the next expansion point.
          </p>
        </section>
      </div>
    </form>
  );
}

function ProductEditor({ product, categories, close, save }) {
  const [form, setForm] = useState(() =>
    product
      ? {
          ...EMPTY_PRODUCT,
          ...product,
          price: String(product.price),
          mrp: String(product.mrp),
          inventory: String(product.inventory ?? 0),
          highlights: product.highlights?.join("\n") || "",
          specs:
            product.specs?.map(([label, value]) => `${label}: ${value}`).join("\n") ||
            "",
        }
      : EMPTY_PRODUCT,
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const requestClose = () => {
    if (!busy && !uploading) close();
  };

  const change = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const uploadImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const result = await uploadAdminImage(file);
      change("image", result.url);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await save(
        {
          ...form,
          price: Number(form.price),
          mrp: Number(form.mrp),
          inventory: Number(form.inventory),
        },
        product?.id,
      );
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-wrap">
      <button
        className="admin-modal-overlay"
        type="button"
        onClick={requestClose}
        aria-label="Close product editor"
        disabled={busy || uploading}
      />
      <form
        className="admin-product-editor"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-product-editor-title"
      >
        <header>
          <div>
            <p className="admin-kicker">{product ? "Edit catalog item" : "New catalog item"}</p>
            <h2 id="admin-product-editor-title">{product ? product.name : "Add a product"}</h2>
          </div>
          <button type="button" onClick={requestClose} aria-label="Close" disabled={busy || uploading}>
            <X size={21} />
          </button>
        </header>
        <div className="admin-editor-body">
          <section className="admin-editor-main">
            <EditorSection title="Basic information">
              <div className="admin-form-grid">
                <AdminField label="Product name" wide>
                  <input value={form.name} onChange={(event) => change("name", event.target.value)} required />
                </AdminField>
                <AdminField label="ASIN / SKU">
                  <input value={form.asin} onChange={(event) => change("asin", event.target.value)} />
                </AdminField>
                <AdminField label="Category">
                  <input
                    list="admin-product-categories"
                    value={form.category}
                    onChange={(event) => change("category", event.target.value)}
                    required
                  />
                  <datalist id="admin-product-categories">
                    {categories.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </AdminField>
                <AdminField label="Short description" wide>
                  <textarea rows="3" value={form.short} onChange={(event) => change("short", event.target.value)} required />
                </AdminField>
              </div>
            </EditorSection>
            <EditorSection title="Pricing and stock">
              <div className="admin-form-grid admin-form-grid--three">
                <AdminField label="Selling price (₹)">
                  <input type="number" min="1" value={form.price} onChange={(event) => change("price", event.target.value)} required />
                </AdminField>
                <AdminField label="MRP (₹)">
                  <input type="number" min="1" value={form.mrp} onChange={(event) => change("mrp", event.target.value)} required />
                </AdminField>
                <AdminField label="Inventory">
                  <input type="number" min="0" step="1" value={form.inventory} onChange={(event) => change("inventory", event.target.value)} required />
                </AdminField>
              </div>
            </EditorSection>
            <EditorSection title="Product details">
              <div className="admin-form-grid">
                <AdminField label="Highlights — one per line">
                  <textarea rows="6" value={form.highlights} onChange={(event) => change("highlights", event.target.value)} />
                </AdminField>
                <AdminField label="Specifications — Label: Value">
                  <textarea rows="6" value={form.specs} onChange={(event) => change("specs", event.target.value)} />
                </AdminField>
              </div>
            </EditorSection>
          </section>
          <aside className="admin-editor-side">
            <EditorSection title="Product image">
              <div className="admin-image-upload">
                {form.image ? (
                  <img src={form.image} alt="Product preview" />
                ) : (
                  <span><ImagePlus size={29} /> No image selected</span>
                )}
                <label>
                  {uploading ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}
                  {uploading ? "Uploading…" : "Upload image"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} disabled={uploading} />
                </label>
              </div>
              <AdminField label="Or image URL">
                <input value={form.image} onChange={(event) => change("image", event.target.value)} placeholder="/products/example.jpg" required />
              </AdminField>
            </EditorSection>
            <EditorSection title="Storefront presentation">
              <AdminField label="Badge">
                <input value={form.badge} onChange={(event) => change("badge", event.target.value)} />
              </AdminField>
              <label className="admin-check-field">
                <input type="checkbox" checked={form.featured} onChange={(event) => change("featured", event.target.checked)} />
                <span>
                  <strong>Featured product</strong>
                  Prioritise in default sorting
                </span>
              </label>
              {product && (
                <label className="admin-check-field">
                  <input type="checkbox" checked={form.active !== false} onChange={(event) => change("active", event.target.checked)} />
                  <span>
                    <strong>Visible on storefront</strong>
                    Customers can discover and buy it
                  </span>
                </label>
              )}
            </EditorSection>
          </aside>
        </div>
        {error && <div className="admin-editor-error">{error}</div>}
        <footer>
          <button type="button" onClick={requestClose} disabled={busy || uploading}>Cancel</button>
          <button className="admin-primary-btn" type="submit" disabled={busy || uploading}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
            {busy ? "Saving…" : "Save product"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function OrderDetail({ order, close, update }) {
  const [status, setStatus] = useState(order.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const copyOrderId = async () => {
    try {
      await navigator.clipboard.writeText(order.orderId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the order number.");
    }
  };

  const submitStatus = async () => {
    setBusy(true);
    setError("");
    try {
      await update(order.orderId, status);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-wrap">
      <button
        className="admin-modal-overlay"
        type="button"
        onClick={close}
        aria-label="Close order"
        disabled={busy}
      />
      <aside
        className="admin-order-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-order-title"
      >
        <header>
          <div>
            <p className="admin-kicker">Order details</p>
            <h2 id="admin-order-title">{order.orderId}</h2>
            <span>{formatDate(order.createdAt)}</span>
          </div>
          <div className="admin-order-header-actions">
            <button
              type="button"
              onClick={copyOrderId}
              aria-label="Copy order number"
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              aria-label="Print order"
            >
              <Printer size={18} />
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              disabled={busy}
            >
              <X size={21} />
            </button>
          </div>
        </header>
        <div className="admin-order-detail__body">
          <section>
            <h3>Customer</h3>
            <p><strong>{order.customer?.name}</strong>{order.customer?.email}<br />{order.customer?.phone}</p>
            <p>{order.customer?.address}, {order.customer?.area}<br />{order.customer?.city}, {order.customer?.state} {order.customer?.pincode}</p>
            <div className="admin-customer-actions">
              {order.customer?.phone && (
                <a href={`tel:${order.customer.phone}`}>
                  <Phone size={15} /> Call
                </a>
              )}
              {order.customer?.email && (
                <a href={`mailto:${order.customer.email}`}>
                  <Mail size={15} /> Email
                </a>
              )}
            </div>
          </section>
          <section>
            <h3>Items</h3>
            <div className="admin-order-products">
              {order.items?.map((item) => (
                <div key={item.id}>
                  <span>{item.quantity}</span>
                  <p><strong>{item.name}</strong><small>{item.asin}</small></p>
                  <b>{formatCurrency(item.price * item.quantity)}</b>
                </div>
              ))}
            </div>
          </section>
          <section className="admin-order-totals">
            <p><span>Subtotal</span><strong>{formatCurrency(order.subtotal)}</strong></p>
            <p><span>Shipping</span><strong>{order.shipping ? formatCurrency(order.shipping) : "FREE"}</strong></p>
            <p><span>Total</span><strong>{formatCurrency(order.total)}</strong></p>
          </section>
          <section>
            <h3>Fulfilment status</h3>
            <div className="admin-current-status">
              <span>Current status</span>
              <StatusPill status={order.status} />
            </div>
            <div className="admin-status-control">
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
              </select>
              <button className="admin-primary-btn" type="button" onClick={submitStatus} disabled={busy || status === order.status}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Update
              </button>
            </div>
          </section>
          {error && <div className="admin-editor-error">{error}</div>}
        </div>
      </aside>
    </div>
  );
}

function ArchiveConfirmation({ product, close, confirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await confirm(product);
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-wrap">
      <button
        className="admin-modal-overlay"
        type="button"
        onClick={close}
        aria-label="Cancel product removal"
        disabled={busy}
      />
      <section
        className="admin-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
      >
        <span className="admin-confirm__icon">
          <Archive size={24} />
        </span>
        <p className="admin-kicker">Remove from storefront</p>
        <h2 id="admin-confirm-title">Hide “{product.name}”?</h2>
        <p>
          Customers will no longer see or purchase this product. Its record
          remains under Archived products, where you can edit and restore it.
        </p>
        {error && <div className="admin-editor-error">{error}</div>}
        <div>
          <button type="button" onClick={close} disabled={busy}>
            Keep product
          </button>
          <button type="button" onClick={remove} disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Archive size={17} />
            )}
            {busy ? "Removing…" : "Remove from store"}
          </button>
        </div>
      </section>
    </div>
  );
}

function EditorSection({ title, children }) {
  return <section className="admin-editor-section"><h3>{title}</h3>{children}</section>;
}

function AdminField({ label, wide = false, children }) {
  return <label className={`admin-field ${wide ? "admin-field--wide" : ""}`}><span>{label}</span>{children}</label>;
}

function SectionIntro({ title, copy, action }) {
  return (
    <div className="admin-section-intro">
      <div><h2>{title}</h2><p>{copy}</p></div>
      {action}
    </div>
  );
}

function StatusPill({ status }) {
  return <span className={`admin-status admin-status--${status}`}>{statusLabel(status)}</span>;
}

function AdminEmpty({ icon: Icon, title, copy }) {
  return (
    <div className="admin-empty">
      <span><Icon size={24} /></span>
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  );
}

export default AdminApp;
