import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  CreditCard,
  Headphones,
  Heart,
  Home,
  LockKeyhole,
  LoaderCircle,
  Mail,
  MapPin,
  Menu,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  Truck,
  X,
  Zap,
  ZoomIn,
} from "lucide-react";
import { CATEGORIES, COLLECTIONS, PRODUCTS } from "./data/products";
import {
  commerceConfigured,
  submitCheckout,
} from "./services/commerce";
import {
  DEFAULT_STOREFRONT_SETTINGS,
  loadCatalog,
} from "./services/catalog";
import { lookupPincode } from "./services/pincode";

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const discountPercent = (product) =>
  Math.round(((product.mrp - product.price) / product.mrp) * 100);

const phoneLink = (phone) => `tel:${String(phone).replace(/[^\d+]/g, "")}`;

const storedIds = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value)
      ? value.filter((item) => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const storedCart = () => {
  try {
    const value = JSON.parse(localStorage.getItem("kelenate-cart"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .map(([id, quantity]) => [
          id,
          Math.min(10, Math.max(0, Math.floor(Number(quantity) || 0))),
        ])
        .filter(([, quantity]) => quantity > 0),
    );
  } catch {
    return {};
  }
};

const CHECKOUT_DRAFT_KEY = "kelenate-checkout-draft";
const CHECKOUT_FIELD_NAMES = [
  "name",
  "phone",
  "email",
  "address",
  "area",
  "city",
  "state",
  "pincode",
];
const EMPTY_CHECKOUT_DETAILS = {
  name: "",
  phone: "",
  email: "",
  address: "",
  area: "",
  city: "",
  state: "",
  pincode: "",
};

const storedCheckoutDetails = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem(CHECKOUT_DRAFT_KEY));
    return CHECKOUT_FIELD_NAMES.reduce(
      (details, field) => ({
        ...details,
        [field]: typeof value?.[field] === "string" ? value[field] : "",
      }),
      {},
    );
  } catch {
    return { ...EMPTY_CHECKOUT_DETAILS };
  }
};

const checkoutFieldError = (field, value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "This field is required.";
  if (field === "name" && normalized.length < 2) {
    return "Enter the customer’s full name.";
  }
  if (field === "phone" && !/^[6-9]\d{9}$/.test(normalized)) {
    return "Enter a valid 10-digit Indian mobile number.";
  }
  if (
    field === "email" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    return "Enter a valid email address.";
  }
  if (field === "address" && normalized.length < 3) {
    return "Add a little more detail.";
  }
  if (["area", "city", "state"].includes(field) && normalized.length < 2) {
    return "Add a little more detail.";
  }
  if (field === "pincode" && !/^[1-9]\d{5}$/.test(normalized)) {
    return "Enter a valid 6-digit Indian PIN code.";
  }
  return "";
};

const productIdFromPath = (pathname) => {
  const match = pathname.match(/^\/products\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

const PRODUCT_OUTCOMES = {
  "habit-tracker":
    "See your streak at a glance, so one missed day does not turn into an abandoned goal.",
  "comic-gift-stickers":
    "Turn a plain gift or parcel into something that feels considered in seconds.",
  "number-alphabet-labels":
    "Make sorting, teaching and organising visual enough to understand at a glance.",
  "spice-jar-labels":
    "Find the right masala faster and make mismatched jars feel like one organised set.",
  "blood-pressure-log":
    "Keep every reading in one clear place, so doctor visits start with useful history.",
  "blood-sugar-log":
    "Turn scattered glucose readings into a weekly record that is easier to discuss and act on.",
  "thermal-labels":
    "Label daily orders quickly without ink, ribbon or handwritten dispatch slips.",
  "moving-labels":
    "Know which box belongs in which room before unpacking turns chaotic.",
  "laminated-envelopes":
    "Send documents in a cleaner, sturdier outer layer made for everyday dispatch.",
  "flash-cards":
    "Turn short facts and prompts into a stack you can revise wherever you are.",
  "shock-absorbers":
    "Soften small door contacts and reduce the sharp noise of everyday closing.",
  "microfiber-cloths":
    "Lift dust and wipe surfaces without reaching for a different cloth every time.",
  "door-edge-guard":
    "Help stop exposed door edges from chipping when parking spaces get tight.",
  "door-handle-protectors":
    "Take everyday fingernail and key contact before your car paint does.",
  "door-sill-protector":
    "Protect the entry strip from the scuffs that build up every time people step in.",
  "reflective-stripes":
    "Make your vehicle easier to notice after dark while adding a clean reflective accent.",
  "wheel-rim-decals":
    "Give wheels a sharper night-time outline without committing to paint.",
};

const CATEGORY_OUTCOMES = {
  "Car protection":
    "Protect the high-contact areas that collect everyday marks before the damage builds up.",
  "Reflective styling":
    "Add a cleaner reflective accent that becomes more visible when light hits it after dark.",
  "Stickers & labels":
    "Make everyday organising faster by giving each item a clear visual place.",
  "Planning & logs":
    "Turn scattered daily information into a record you can understand at a glance.",
  "Business supplies":
    "Remove one repetitive step from packing, labelling or everyday desk work.",
};

const PRODUCT_PAIRINGS = {
  "habit-tracker": ["flash-cards", "blood-pressure-log"],
  "comic-gift-stickers": ["laminated-envelopes", "moving-labels"],
  "number-alphabet-labels": ["flash-cards", "moving-labels"],
  "spice-jar-labels": ["microfiber-cloths", "number-alphabet-labels"],
  "blood-pressure-log": ["blood-sugar-log", "habit-tracker"],
  "blood-sugar-log": ["blood-pressure-log", "habit-tracker"],
  "thermal-labels": ["moving-labels", "laminated-envelopes"],
  "moving-labels": ["laminated-envelopes", "thermal-labels"],
  "laminated-envelopes": ["thermal-labels", "moving-labels"],
  "flash-cards": ["number-alphabet-labels", "habit-tracker"],
  "shock-absorbers": ["door-edge-guard", "microfiber-cloths"],
  "microfiber-cloths": ["door-handle-protectors", "door-sill-protector"],
  "door-edge-guard": ["shock-absorbers", "microfiber-cloths"],
  "door-handle-protectors": ["microfiber-cloths", "door-edge-guard"],
  "door-sill-protector": ["microfiber-cloths", "door-handle-protectors"],
  "reflective-stripes": ["wheel-rim-decals", "microfiber-cloths"],
  "wheel-rim-decals": ["reflective-stripes", "microfiber-cloths"],
};

const outcomeFor = (product) =>
  PRODUCT_OUTCOMES[product.id] ||
  CATEGORY_OUTCOMES[product.category] ||
  product.short;

const policiesFor = (settings) => ({
  shipping: {
    eyebrow: "Shipping & delivery",
    title: "Simple delivery, without surprises.",
    icon: Truck,
    sections: [
      {
        heading: "Shipping charges",
        body: `Delivery is free when your cart value is ${formatCurrency(settings.shipping.freeThreshold)} or more. A flat ${formatCurrency(settings.shipping.standardFee)} shipping fee applies to smaller orders.`,
      },
      {
        heading: "Dispatch and delivery",
        body: "Orders are normally packed within 1–2 business days. Standard delivery usually takes 3–7 business days after dispatch, depending on the serviceable PIN code.",
      },
      {
        heading: "Tracking",
        body: "Once the order is handed to our courier partner, tracking details are shared by SMS and email. Shiprocket will power shipment allocation and tracking at launch.",
      },
      {
        heading: "Delays",
        body: "Weather, local restrictions and remote-area service limitations can occasionally affect timelines. Our support team will help if a shipment stops updating.",
      },
    ],
  },
  returns: {
    eyebrow: "Returns & replacements",
    title: `A fair ${settings.returns.windowDays}-day resolution window.`,
    icon: PackageCheck,
    sections: [
      {
        heading: "Return eligibility",
        body: `Unused items in their original condition and packaging may be requested for return within ${settings.returns.windowDays} days of delivery. Applied stickers, used automotive accessories and customised items cannot be returned.`,
      },
      {
        heading: "Damaged or incorrect items",
        body: "If an item arrives damaged, defective or different from the order, contact us within 48 hours with the order number and clear photos. We will arrange a replacement or refund after verification.",
      },
      {
        heading: "Fit and installation",
        body: "Please review product measurements and compatibility before ordering. Damage caused by incorrect surface preparation, forced fitting or installation is not covered.",
      },
      {
        heading: "Refund timing",
        body: "Approved refunds are initiated to the original payment method and generally reflect within 5–7 business days. COD refunds may require bank or UPI details.",
      },
    ],
  },
  privacy: {
    eyebrow: "Privacy",
    title: "Your information stays yours.",
    icon: LockKeyhole,
    sections: [
      {
        heading: "Information collected",
        body: "We collect the contact, address and payment-status information needed to process orders, provide support and meet invoicing obligations.",
      },
      {
        heading: "How it is used",
        body: "Order data is used for payment processing, delivery, customer support, fraud prevention and legally required accounting. We do not sell customer information.",
      },
      {
        heading: "Service providers",
        body: "Necessary order details may be shared securely with payment, courier, analytics and communication providers that help operate the store.",
      },
      {
        heading: "Contact",
        body: `For privacy or data requests, email ${settings.support.email} with the subject “Privacy request”.`,
      },
    ],
  },
  terms: {
    eyebrow: "Terms of sale",
    title: "Clear terms for every order.",
    icon: ShieldCheck,
    sections: [
      {
        heading: "Product information",
        body: "We aim to present accurate images, dimensions and descriptions. Minor colour differences can occur because of screen settings or manufacturing batches.",
      },
      {
        heading: "Pricing and availability",
        body: "Prices include applicable taxes unless stated otherwise. Availability and promotions may change before payment confirmation.",
      },
      {
        heading: "Order acceptance",
        body: "An order is accepted after payment confirmation or COD verification. We may cancel and refund orders affected by stock errors, invalid delivery information or suspected misuse.",
      },
      {
        heading: "Business identity",
        body: "Kelenate is operated by M/s North West, GSTIN AJPPG2208L1Z4, Wazirpur Industrial Area, Delhi 110052.",
      },
    ],
  },
});

function App() {
  const [catalog, setCatalog] = useState(PRODUCTS);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [storeSettings, setStoreSettings] = useState(
    DEFAULT_STOREFRONT_SETTINGS,
  );
  const [pathname, setPathname] = useState(window.location.pathname);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All products");
  const [sort, setSort] = useState("featured");
  const [visibleCount, setVisibleCount] = useState(8);
  const [cart, setCart] = useState(storedCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [wishlist, setWishlist] = useState(() =>
    storedIds("kelenate-wishlist"),
  );
  const [recentlyViewed, setRecentlyViewed] = useState(() =>
    storedIds("kelenate-recently-viewed"),
  );
  const [imagePreview, setImagePreview] = useState(null);
  const [quickView, setQuickView] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [policy, setPolicy] = useState(null);
  const [toast, setToast] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [mobileDockVisible, setMobileDockVisible] = useState(
    window.scrollY > 320,
  );
  const searchRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("kelenate-cart", JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem("kelenate-wishlist", JSON.stringify(wishlist));
  }, [wishlist]);

  useEffect(() => {
    localStorage.setItem(
      "kelenate-recently-viewed",
      JSON.stringify(recentlyViewed),
    );
  }, [recentlyViewed]);

  useEffect(() => {
    let current = true;
    loadCatalog()
      .then(({ products, settings }) => {
        if (current && products.length) setCatalog(products);
        if (current) setStoreSettings(settings);
      })
      .catch(() => {
        // The bundled catalog keeps the storefront available in preview mode.
      })
      .finally(() => {
        if (current) setCatalogLoaded(true);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!catalogLoaded) return;
    setCart((current) => {
      const next = {};
      let changed = false;

      Object.entries(current).forEach(([id, requestedQuantity]) => {
        const product = catalog.find((item) => item.id === id);
        if (!product) {
          changed = true;
          return;
        }

        const maximum = Math.min(
          10,
          Math.max(0, Number(product.inventory ?? 10)),
        );
        const quantity = Math.min(
          maximum,
          Math.max(0, Math.floor(Number(requestedQuantity) || 0)),
        );
        if (quantity > 0) next[id] = quantity;
        if (quantity !== requestedQuantity) changed = true;
      });

      return changed ? next : current;
    });
  }, [catalog, catalogLoaded]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const overlayOpen =
      cartOpen ||
      searchOpen ||
      wishlistOpen ||
      imagePreview ||
      quickView ||
      checkoutOpen ||
      policy ||
      mobileMenu;
    document.body.classList.toggle("no-scroll", Boolean(overlayOpen));
    return () => document.body.classList.remove("no-scroll");
  }, [
    cartOpen,
    searchOpen,
    wishlistOpen,
    imagePreview,
    quickView,
    checkoutOpen,
    policy,
    mobileMenu,
  ]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      setCartOpen(false);
      setSearchOpen(false);
      setWishlistOpen(false);
      setImagePreview(null);
      setQuickView(null);
      setCheckoutOpen(false);
      setPolicy(null);
      setMobileMenu(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  useEffect(() => {
    const handleSearchShortcut = (event) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable);
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      setPathname(window.location.pathname);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  useEffect(() => {
    const updateMobileDock = () => setMobileDockVisible(window.scrollY > 320);
    updateMobileDock();
    window.addEventListener("scroll", updateMobileDock, { passive: true });
    return () => window.removeEventListener("scroll", updateMobileDock);
  }, [pathname]);

  useEffect(() => {
    if (!window.IntersectionObserver) return undefined;
    const elements = [...document.querySelectorAll("[data-reveal]")];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pathname, catalogLoaded, visibleCount]);

  const productRouteId = productIdFromPath(pathname);
  const activeProduct = productRouteId
    ? catalog.find((product) => product.id === productRouteId)
    : null;

  useEffect(() => {
    if (!activeProduct) return;
    setRecentlyViewed((current) => [
      activeProduct.id,
      ...current.filter((id) => id !== activeProduct.id),
    ].slice(0, 6));
  }, [activeProduct]);

  useEffect(() => {
    const title = activeProduct
      ? `${activeProduct.name} — Kelenate`
      : "Kelenate — Practical products for everyday life";
    const description =
      activeProduct?.short ||
      "Practical Kelenate products for cars, homes, routines and small businesses.";
    document.title = title;

    let descriptionTag = document.querySelector('meta[name="description"]');
    if (!descriptionTag) {
      descriptionTag = document.createElement("meta");
      descriptionTag.name = "description";
      document.head.appendChild(descriptionTag);
    }
    descriptionTag.content = description;

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = `${window.location.origin}${
      activeProduct ? `/products/${encodeURIComponent(activeProduct.id)}` : "/"
    }`;

    const structuredDataId = "kelenate-product-structured-data";
    document.getElementById(structuredDataId)?.remove();
    if (activeProduct) {
      const structuredData = document.createElement("script");
      structuredData.id = structuredDataId;
      structuredData.type = "application/ld+json";
      structuredData.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: activeProduct.name,
        image: `${window.location.origin}${activeProduct.image}`,
        description: activeProduct.short,
        sku: activeProduct.asin || activeProduct.id,
        brand: { "@type": "Brand", name: "Kelenate" },
        offers: {
          "@type": "Offer",
          priceCurrency: "INR",
          price: activeProduct.price,
          availability:
            Number(activeProduct.inventory ?? 1) > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
        },
        ...(activeProduct.rating
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: activeProduct.rating,
                reviewCount: activeProduct.reviews,
              },
            }
          : {}),
      });
      document.head.appendChild(structuredData);
    }
  }, [activeProduct]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = catalog.filter((product) => {
      const inCategory =
        category === "All products" || product.category === category;
      const searchable = [
        product.name,
        product.sourceTitle,
        product.category,
        product.asin,
        ...product.highlights,
      ]
        .join(" ")
        .toLowerCase();
      return inCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
    });

    return [...filtered].sort((a, b) => {
      if (sort === "price-low") return a.price - b.price;
      if (sort === "price-high") return b.price - a.price;
      if (sort === "rating") return (b.rating || 0) - (a.rating || 0);
      return Number(b.featured) - Number(a.featured);
    });
  }, [catalog, category, query, sort]);

  const categories = useMemo(
    () => [
      "All products",
      ...new Set([
        ...CATEGORIES.slice(1),
        ...catalog.map((product) => product.category),
      ]),
    ],
    [catalog],
  );

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => ({
          product: catalog.find((product) => product.id === id),
          quantity,
        }))
        .filter((item) => item.product),
    [cart, catalog],
  );

  const savedProducts = useMemo(
    () =>
      wishlist
        .map((id) => catalog.find((product) => product.id === id))
        .filter(Boolean),
    [wishlist, catalog],
  );

  const recentProducts = useMemo(
    () =>
      recentlyViewed
        .map((id) => catalog.find((product) => product.id === id))
        .filter(Boolean),
    [recentlyViewed, catalog],
  );

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0,
  );
  const shipping =
    subtotal === 0 ||
    subtotal >= storeSettings.shipping.freeThreshold
      ? 0
      : storeSettings.shipping.standardFee;
  const total = subtotal + shipping;

  const showToast = (message) => setToast(message);

  const toggleWishlist = (product) => {
    const isSaved = wishlist.includes(product.id);
    setWishlist((current) =>
      isSaved
        ? current.filter((id) => id !== product.id)
        : [product.id, ...current],
    );
    showToast(
      isSaved
        ? `${product.name} removed from saved items`
        : `${product.name} saved for later`,
    );
  };

  const addToCart = (product, quantity = 1) => {
    const maximum = Math.min(10, Math.max(0, Number(product.inventory ?? 10)));
    if (maximum === 0) {
      showToast(`${product.name} is currently unavailable`);
      return;
    }
    setCart((current) => ({
      ...current,
      [product.id]: Math.min(
        maximum,
        Number(current[product.id] || 0) +
          Math.max(1, Math.floor(Number(quantity) || 1)),
      ),
    }));
    showToast(
      Number(cart[product.id] || 0) >= maximum
        ? `${product.name} is already at the cart limit`
        : `${product.name} added to cart`,
    );
  };

  const buyNow = (product, quantity = 1) => {
    const maximum = Math.min(10, Math.max(0, Number(product.inventory ?? 10)));
    if (maximum === 0) {
      showToast(`${product.name} is currently unavailable`);
      return;
    }
    setCart((current) => ({
      ...current,
      [product.id]: Math.min(
        maximum,
        Number(current[product.id] || 0) +
          Math.max(1, Math.floor(Number(quantity) || 1)),
      ),
    }));
    setToast("");
    setCartOpen(false);
    setCheckoutOpen(true);
  };

  const updateQuantity = (productId, quantity) => {
    setCart((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[productId];
      else {
        const product = catalog.find((item) => item.id === productId);
        const maximum = Math.min(
          10,
          Math.max(0, Number(product?.inventory ?? 10)),
        );
        if (maximum === 0) delete next[productId];
        else {
          next[productId] = Math.min(
            maximum,
            Math.max(1, Math.floor(Number(quantity) || 1)),
          );
        }
      }
      return next;
    });
  };

  const openHome = (hash = "") => {
    const nextUrl = hash ? `/${hash}` : "/";
    window.history.pushState({}, "", nextUrl);
    setPathname("/");
  };

  const openProduct = (product) => {
    window.history.pushState({}, "", `/products/${encodeURIComponent(product.id)}`);
    setPathname(`/products/${product.id}`);
    setSearchOpen(false);
    setWishlistOpen(false);
    setQuickView(null);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const shopCategory = (nextCategory) => {
    setCategory(nextCategory);
    setVisibleCount(8);
    if (productRouteId) openHome("#shop");
    window.setTimeout(
      () => document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }),
      productRouteId ? 50 : 0,
    );
  };

  const focusSearch = () => {
    setSearchOpen(true);
  };

  const cartRecommendation = catalog.find(
    (product) =>
      Number(product.inventory ?? 1) > 0 &&
      !cart[product.id] &&
      product.featured,
  );

  return (
    <div className="site-shell">
      <Announcement settings={storeSettings} />
      <Header
        cartCount={cartCount}
        onCart={() => {
          setToast("");
          setCartOpen(true);
        }}
        onSearch={focusSearch}
        wishlistCount={savedProducts.length}
        onWishlist={() => setWishlistOpen(true)}
        mobileMenu={mobileMenu}
        setMobileMenu={setMobileMenu}
        onCategory={shopCategory}
        categories={categories}
        settings={storeSettings}
      />
      {productRouteId ? (
        activeProduct ? (
          <ProductPage
            product={activeProduct}
            catalog={catalog}
            settings={storeSettings}
            onHome={() => openHome()}
            onCategory={shopCategory}
            onAdd={addToCart}
            onBuyNow={buyNow}
            onProduct={openProduct}
            saved={wishlist.includes(activeProduct.id)}
            onToggleSave={toggleWishlist}
            onImagePreview={setImagePreview}
            onNotify={showToast}
          />
        ) : (
          <ProductRouteState
            loading={!catalogLoaded}
            onHome={() => openHome()}
          />
        )
      ) : (
        <main className="store-home">
          <Hero
            onShop={() => shopCategory("All products")}
            onCategory={shopCategory}
            settings={storeSettings}
            catalogCount={catalog.length}
            onProduct={(id) => {
              const product = catalog.find((item) => item.id === id);
              if (product) openProduct(product);
            }}
          />
          <TrustStrip settings={storeSettings} />
          <BrandPromise catalog={catalog} />
          <Collections onCategory={shopCategory} />
          <FeatureShowcase catalog={catalog} onProduct={openProduct} />
          <Shop
            category={category}
            setCategory={(value) => {
              setCategory(value);
              setVisibleCount(8);
            }}
            query={query}
            setQuery={setQuery}
            sort={sort}
            setSort={setSort}
            searchRef={searchRef}
            products={filteredProducts}
            visibleCount={visibleCount}
            setVisibleCount={setVisibleCount}
            onProduct={openProduct}
            onAdd={addToCart}
            categories={categories}
            wishlist={wishlist}
            onToggleSave={toggleWishlist}
          />
          {recentProducts.length > 0 && (
            <RecentlyViewed
              products={recentProducts}
              onProduct={openProduct}
              onAdd={addToCart}
            />
          )}
          <MarketplaceProof catalog={catalog} onQuickView={setQuickView} />
          <BrandStory />
          <Faq settings={storeSettings} />
          <SupportBand settings={storeSettings} />
        </main>
      )}
      <Footer
        onPolicy={setPolicy}
        onCategory={shopCategory}
        categories={categories}
        settings={storeSettings}
      />

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cartItems}
        subtotal={subtotal}
        shipping={shipping}
        total={total}
        onUpdate={updateQuantity}
        onCheckout={() => {
          setToast("");
          setCartOpen(false);
          setCheckoutOpen(true);
        }}
        shippingSettings={storeSettings.shipping}
        recommendation={cartRecommendation}
        onAdd={addToCart}
        onProduct={openProduct}
      />

      {searchOpen && (
        <SearchExperience
          products={catalog}
          categories={categories}
          onClose={() => setSearchOpen(false)}
          onProduct={openProduct}
          onCategory={(nextCategory) => {
            setSearchOpen(false);
            shopCategory(nextCategory);
          }}
        />
      )}

      {wishlistOpen && (
        <WishlistDrawer
          products={savedProducts}
          onClose={() => setWishlistOpen(false)}
          onProduct={openProduct}
          onAdd={addToCart}
          onRemove={toggleWishlist}
        />
      )}

      {imagePreview && (
        <ImagePreview
          product={imagePreview}
          onClose={() => setImagePreview(null)}
        />
      )}

      {quickView && (
        <QuickView
          product={quickView}
          onClose={() => setQuickView(null)}
          onAdd={addToCart}
          settings={storeSettings}
          onProduct={openProduct}
        />
      )}

      {checkoutOpen && (
        <Checkout
          items={cartItems}
          subtotal={subtotal}
          shipping={shipping}
          total={total}
          settings={storeSettings}
          onUpdate={updateQuantity}
          onClose={() => setCheckoutOpen(false)}
          onComplete={() => setCart({})}
        />
      )}

      {policy && (
        <PolicyModal
          type={policy}
          onClose={() => setPolicy(null)}
          settings={storeSettings}
        />
      )}

      <a
        className="whatsapp-fab"
        href={`https://wa.me/${storeSettings.support.whatsapp}?text=Hi%20Kelenate%2C%20I%20need%20help%20with%20a%20product.`}
        target="_blank"
        rel="noreferrer"
        aria-label="Chat with Kelenate on WhatsApp"
      >
        <Phone size={20} />
        <span>Need help?</span>
      </a>

      {!productRouteId && mobileDockVisible && (
        <MobileDock
          cartCount={cartCount}
          wishlistCount={savedProducts.length}
          onSearch={focusSearch}
          onWishlist={() => setWishlistOpen(true)}
          onCart={() => {
            setToast("");
            setCartOpen(true);
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Announcement({ settings }) {
  return (
    <div className="announcement">
      <span>
        <Truck size={15} /> Free shipping on orders of{" "}
        {formatCurrency(settings.shipping.freeThreshold)} or more
      </span>
      <span className="announcement-secondary">
        <ShieldCheck size={15} /> {settings.returns.windowDays}-day returns &
        replacements
      </span>
    </div>
  );
}

function Header({
  cartCount,
  onCart,
  onSearch,
  wishlistCount,
  onWishlist,
  mobileMenu,
  setMobileMenu,
  onCategory,
  categories,
  settings,
}) {
  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <a className="brand" href="/" aria-label="Kelenate home">
            <img
              src="/brand/kelenate-logo.jpeg"
              alt="Kelenate"
              decoding="async"
            />
          </a>
          <nav className="desktop-nav" aria-label="Primary navigation">
            <a href="/#collections">Collections</a>
            <a href="/#shop">Shop all</a>
            <a href="/#story">Our story</a>
            <a href="/#faq">Help</a>
          </nav>
          <div className="header-actions">
            <button
              className="icon-button search-button"
              type="button"
              onClick={onSearch}
              aria-label="Search products"
            >
              <Search size={21} />
            </button>
            <button
              className="icon-button wishlist-button"
              type="button"
              onClick={onWishlist}
              aria-label={`Open saved items with ${wishlistCount} products`}
            >
              <Heart size={20} fill={wishlistCount ? "currentColor" : "none"} />
              {wishlistCount > 0 && <b>{wishlistCount}</b>}
            </button>
            <button
              className="cart-button"
              type="button"
              onClick={onCart}
              aria-label={`Open cart with ${cartCount} items`}
            >
              <ShoppingBag size={20} />
              <span>Cart</span>
              <b>{cartCount}</b>
            </button>
            <button
              className="icon-button menu-button"
              type="button"
              onClick={() => setMobileMenu(true)}
              aria-label="Open menu"
            >
              <Menu size={23} />
            </button>
          </div>
        </div>
      </header>

      {mobileMenu && (
        <div className="mobile-menu-wrap">
          <button
            className="overlay-backdrop"
            aria-label="Close menu"
            onClick={() => setMobileMenu(false)}
          />
          <div className="mobile-menu">
            <div className="mobile-menu-head">
              <img src="/brand/kelenate-logo.jpeg" alt="Kelenate" />
              <button
                className="icon-button"
                type="button"
                onClick={() => setMobileMenu(false)}
                aria-label="Close menu"
              >
                <X size={22} />
              </button>
            </div>
            <p className="eyebrow">Explore Kelenate</p>
            <button
              type="button"
              onClick={() => {
                setMobileMenu(false);
                onSearch();
              }}
            >
              Search products
              <Search size={18} />
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenu(false);
                onWishlist();
              }}
            >
              Saved items
              <span className="mobile-menu-count">{wishlistCount}</span>
            </button>
            {categories.slice(1).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setMobileMenu(false);
                  onCategory(item);
                }}
              >
                {item}
                <ArrowRight size={18} />
              </button>
            ))}
            <div className="mobile-menu-contact">
              <span>Support, {settings.support.hours}</span>
              <a href={phoneLink(settings.support.phone)}>
                {settings.support.phone}
              </a>
              <a
                href={`https://wa.me/${settings.support.whatsapp}`}
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp support
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SearchExperience({
  products,
  categories,
  onClose,
  onProduct,
  onCategory,
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  const normalized = value.trim().toLowerCase();
  const results = useMemo(() => {
    if (!normalized) {
      return products
        .filter((product) => product.featured)
        .slice(0, 5);
    }
    return products
      .filter((product) =>
        [
          product.name,
          product.sourceTitle,
          product.category,
          product.asin,
          ...(product.highlights || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, 7);
  }, [normalized, products]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="modal-wrap search-experience-wrap">
      <button
        className="overlay-backdrop"
        type="button"
        aria-label="Close search"
        onClick={onClose}
      />
      <section
        className="search-experience"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-experience-title"
      >
        <div className="search-experience__field">
          <Search size={22} />
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="What are you looking for?"
            aria-label="Search all Kelenate products"
          />
          {value && (
            <button
              className="search-experience__clear"
              type="button"
              onClick={() => setValue("")}
              aria-label="Clear search"
            >
              <X size={17} />
            </button>
          )}
          <button
            className="search-experience__close"
            type="button"
            onClick={onClose}
            aria-label="Close search"
          >
            <X size={20} />
          </button>
        </div>

        <div className="search-experience__body">
          <aside>
            <p className="eyebrow">Browse by collection</p>
            <div className="search-categories">
              {categories.slice(1).map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => onCategory(category)}
                >
                  <span>{category}</span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
            <div className="search-help">
              <span>/</span>
              Press anywhere to search
            </div>
          </aside>

          <div className="search-results">
            <div className="search-results__head">
              <div>
                <p className="eyebrow">
                  {normalized ? "Search results" : "Popular right now"}
                </p>
                <h2 id="search-experience-title">
                  {normalized
                    ? results.length
                      ? `${results.length} useful matches`
                      : "Nothing exact yet"
                    : "Start with a favourite."}
                </h2>
              </div>
              {normalized && <span>“{value.trim()}”</span>}
            </div>

            {results.length ? (
              <div className="search-result-list">
                {results.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => onProduct(product)}
                  >
                    <img src={product.image} alt="" />
                    <span>
                      <small>{product.category}</small>
                      <strong>{product.name}</strong>
                      <em>
                        {formatCurrency(product.price)}
                        <del>{formatCurrency(product.mrp)}</del>
                      </em>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="search-no-results">
                <Search size={26} />
                <p>Try “labels”, “car protection” or “tracker”.</p>
                <button type="button" onClick={() => setValue("")}>
                  Browse popular products
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function WishlistDrawer({
  products,
  onClose,
  onProduct,
  onAdd,
  onRemove,
}) {
  return (
    <div className="drawer-wrap">
      <button
        className="overlay-backdrop"
        type="button"
        aria-label="Close saved items"
        onClick={onClose}
      />
      <aside className="wishlist-drawer" aria-label="Saved items">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Keep for later</p>
            <h2>Saved items</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close saved items"
          >
            <X size={22} />
          </button>
        </div>

        {products.length ? (
          <>
            <p className="wishlist-intro">
              Your shortlist stays on this device, ready whenever you return.
            </p>
            <div className="wishlist-items">
              {products.map((product) => (
                <article key={product.id} className="wishlist-item">
                  <button
                    type="button"
                    className="wishlist-item__image"
                    onClick={() => onProduct(product)}
                    aria-label={`View ${product.name}`}
                  >
                    <img src={product.image} alt="" />
                  </button>
                  <div>
                    <small>{product.category}</small>
                    <button
                      type="button"
                      className="wishlist-item__name"
                      onClick={() => onProduct(product)}
                    >
                      {product.name}
                    </button>
                    <p>
                      <strong>{formatCurrency(product.price)}</strong>
                      <del>{formatCurrency(product.mrp)}</del>
                    </p>
                    <div>
                      <button
                        type="button"
                        className="wishlist-item__add"
                        onClick={() => onAdd(product)}
                      >
                        <ShoppingBag size={15} /> Add to cart
                      </button>
                      <button
                        type="button"
                        className="wishlist-item__remove"
                        onClick={() => onRemove(product)}
                        aria-label={`Remove ${product.name} from saved items`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-cart">
            <div>
              <Heart size={30} />
            </div>
            <h3>Your saved list is waiting.</h3>
            <p>Tap the heart on any product to keep it here for later.</p>
            <button
              className="button button-primary"
              type="button"
              onClick={onClose}
            >
              Explore products
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

function ImagePreview({ product, onClose }) {
  return (
    <div className="modal-wrap image-preview-wrap">
      <button
        className="overlay-backdrop"
        type="button"
        onClick={onClose}
        aria-label="Close product image"
      />
      <figure
        className="image-preview"
        role="dialog"
        aria-modal="true"
        aria-label={`${product.name} image preview`}
      >
        <button
          className="image-preview__close"
          type="button"
          onClick={onClose}
          aria-label="Close product image"
        >
          <X size={22} />
        </button>
        <img src={product.image} alt={product.name} />
        <figcaption>
          <span>
            <small>{product.category}</small>
            <strong>{product.name}</strong>
          </span>
          <span>Product image</span>
        </figcaption>
      </figure>
    </div>
  );
}

function MobileDock({
  cartCount,
  wishlistCount,
  onSearch,
  onWishlist,
  onCart,
}) {
  return (
    <nav className="mobile-dock" aria-label="Quick navigation">
      <a href="/" aria-current="page">
        <Home size={19} />
        <span>Home</span>
      </a>
      <button type="button" onClick={onSearch}>
        <Search size={19} />
        <span>Search</span>
      </button>
      <button type="button" onClick={onWishlist}>
        <span className="mobile-dock__icon">
          <Heart size={19} fill={wishlistCount ? "currentColor" : "none"} />
          {wishlistCount > 0 && <b>{wishlistCount}</b>}
        </span>
        <span>Saved</span>
      </button>
      <button type="button" onClick={onCart}>
        <span className="mobile-dock__icon">
          <ShoppingBag size={19} />
          {cartCount > 0 && <b>{cartCount}</b>}
        </span>
        <span>Cart</span>
      </button>
    </nav>
  );
}

function Hero({ onShop, onCategory, settings, catalogCount, onProduct }) {
  return (
    <section className="hero">
      <div className="hero-backdrop" aria-hidden="true" />
      <div className="container hero-grid">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="kicker-mark">
              <Sparkles size={15} />
            </span>
            Refined through 15 years of real orders
          </div>
          <h1>
            Small problems.
            <span>Beautifully solved.</span>
          </h1>
          <p>
            Car protection, reflective styling, stickers and labels, planning
            trackers, and business supplies—made practical for everyday use.
          </p>
          <nav className="hero-category-nav" aria-label="Shop product categories">
            <div>
              {CATEGORIES.slice(1).map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => onCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          </nav>
          <div className="hero-actions">
            <button className="button button-primary" type="button" onClick={onShop}>
              Shop all products <ArrowRight size={18} />
            </button>
            <a className="hero-secondary-link" href="#collections">
              View collections <ArrowRight size={16} />
            </a>
          </div>
          <div className="hero-proof">
            <div>
              <strong>{catalogCount}</strong>
              <span>considered products</span>
            </div>
            <div>
              <strong>{formatCurrency(settings.shipping.freeThreshold)}+</strong>
              <span>ships free</span>
            </div>
            <div>
              <strong>{settings.returns.windowDays} days</strong>
              <span>resolution window</span>
            </div>
          </div>
        </div>

        <div className="hero-visual" aria-label="Featured Kelenate products">
          <button
            className="hero-card hero-card-main"
            type="button"
            onClick={() => onProduct("habit-tracker")}
            aria-label="View Undated Habit Tracker"
          >
            <span className="hero-card-label">Build better habits</span>
            <img
              src="/products/habit-tracker.jpg"
              alt="Kelenate habit tracker"
              fetchPriority="high"
              decoding="async"
            />
            <div>
              <strong>Undated Habit Tracker</strong>
              <span>From ₹199</span>
            </div>
          </button>
          <button
            className="hero-card hero-card-small hero-card-auto"
            type="button"
            onClick={() => onProduct("shock-absorbers")}
            aria-label="View car shock absorber pads"
          >
            <span className="mini-badge">Universal fit</span>
            <img
              src="/products/shock-absorbers.jpg"
              alt="Kelenate car shock absorber pads"
            />
            <strong>Protect the details</strong>
          </button>
          <button
            className="hero-card hero-card-small hero-card-labels"
            type="button"
            onClick={() => onProduct("thermal-labels")}
            aria-label="View Direct Thermal Labels"
          >
            <span className="mini-badge">1,600 labels</span>
            <img src="/products/thermal-labels.jpg" alt="Kelenate thermal labels" />
            <strong>Business-ready</strong>
          </button>
          <div className="hero-float hero-float-rating">
            <span className="hero-rating-mark">
              <Star size={16} fill="currentColor" />
            </span>
            <p>
              <strong>4.2 · 94 ratings</strong>
              <span>Imported from our Amazon listing</span>
            </p>
          </div>
          <div className="hero-float hero-float-delivery">
            <Truck size={19} />
            <span>Pan-India delivery</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustStrip({ settings }) {
  const benefits = [
    [
      Truck,
      "Free shipping",
      `On ${formatCurrency(settings.shipping.freeThreshold)} or more`,
    ],
    [PackageCheck, "Careful packing", "Protected in transit"],
    [CreditCard, "Secure checkout", "UPI, cards & COD"],
    [Headphones, "Real support", settings.support.hours],
  ];
  return (
    <section className="trust-strip" aria-label="Shopping benefits">
      <div className="container trust-grid">
        {benefits.map(([Icon, title, text]) => (
          <div className="trust-item" key={title}>
            <span>
              <Icon size={20} />
            </span>
            <div>
              <strong>{title}</strong>
              <small>{text}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BrandPromise({ catalog }) {
  const ratingCount = catalog.reduce(
    (total, product) => total + Number(product.reviews || 0),
    0,
  );
  const weightedRating = ratingCount
    ? catalog.reduce(
        (total, product) =>
          total + Number(product.rating || 0) * Number(product.reviews || 0),
        0,
      ) / ratingCount
    : 0;
  const moments = [
    {
      icon: ShieldCheck,
      index: "01",
      title: "Protect the details",
      copy: "Small safeguards for the parts of your car that meet real life every day.",
    },
    {
      icon: Sparkles,
      index: "02",
      title: "Create visible order",
      copy: "Clear labels and business essentials that make busy spaces easier to read.",
    },
    {
      icon: CheckCircle2,
      index: "03",
      title: "Make progress tangible",
      copy: "Simple paper tools that turn intentions, routines and readings into something you can see.",
    },
  ];

  return (
    <section className="brand-promise" data-reveal>
      <div className="container">
        <div className="brand-promise__head">
          <div>
            <p className="eyebrow">Designed around real life</p>
            <h2>
              Daily life doesn’t need more stuff.
              <span>It needs better answers.</span>
            </h2>
          </div>
          <p>
            Kelenate starts with the quiet friction people experience every
            day, then makes the solution clear, dependable and fairly priced.
          </p>
        </div>

        <div className="brand-promise__moments">
          {moments.map(({ icon: Icon, index, title, copy }) => (
            <article key={title}>
              <div>
                <span>{index}</span>
                <Icon size={23} />
              </div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>

        <div className="brand-promise__evidence">
          <p>
            <strong>15 years</strong>
            <span>learning from real orders</span>
          </p>
          <p>
            <strong>{catalog.length}</strong>
            <span>focused launch products</span>
          </p>
          <p>
            <strong>
              {weightedRating ? weightedRating.toFixed(1) : "New"}
              {weightedRating ? " / 5" : ""}
            </strong>
            <span>
              across {ratingCount} ratings — imported from Amazon listings
            </span>
          </p>
          <p>
            <strong>Delhi</strong>
            <span>packed and supported by people</span>
          </p>
        </div>
      </div>
    </section>
  );
}

function Collections({ onCategory }) {
  return (
    <section className="section collections-section" id="collections" data-reveal>
      <div className="container">
        <SectionHeading
          eyebrow="Shop by collection"
          title="Start with what you need."
          copy="Focused collections make a surprisingly broad catalog easy to explore."
        />
        <div className="collections-grid">
          {COLLECTIONS.map((collection, index) => (
            <button
              className={`collection-card collection-${collection.accent} ${
                index === 0 ? "collection-large" : ""
              }`}
              key={collection.name}
              type="button"
              onClick={() => onCategory(collection.name)}
            >
              <div className="collection-copy">
                <span>{collection.kicker}</span>
                <h3>{collection.name}</h3>
                <p>{collection.description}</p>
                <small>
                  {collection.count} <ArrowRight size={16} />
                </small>
              </div>
              <div className="collection-image">
                <img
                  src={collection.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureShowcase({ catalog, onProduct }) {
  const showcaseConfig = [
    {
      id: "shock-absorbers",
      tab: "Protect",
      note: "For the details that take the daily knocks.",
    },
    {
      id: "number-alphabet-labels",
      tab: "Organise",
      note: "For spaces that work better when everything has a place.",
    },
    {
      id: "habit-tracker",
      tab: "Progress",
      note: "For goals that become easier when progress stays visible.",
    },
  ];
  const items = showcaseConfig
    .map((config) => ({
      ...config,
      product: catalog.find((product) => product.id === config.id),
    }))
    .filter((item) => item.product);
  const [selectedId, setSelectedId] = useState(
    items[0]?.id || showcaseConfig[0].id,
  );
  const selected =
    items.find((item) => item.id === selectedId) || items[0];

  if (!selected) return null;
  const product = selected.product;
  const handleTabKeyDown = (event, index) => {
    const keyOffsets = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    let nextIndex = index;

    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (keyOffsets[event.key]) {
      nextIndex = (index + keyOffsets[event.key] + items.length) % items.length;
    } else {
      return;
    }

    event.preventDefault();
    setSelectedId(items[nextIndex].id);
    const tabButtons =
      event.currentTarget.parentElement?.querySelectorAll('[role="tab"]');
    tabButtons?.[nextIndex]?.focus();
  };

  return (
    <section className="feature-showcase" data-reveal>
      <div className="container feature-showcase__shell">
        <div className="feature-showcase__intro">
          <p className="eyebrow">The Kelenate standard</p>
          <h2>
            One idea.
            <span>Genuinely useful.</span>
          </h2>
          <p>
            Different categories, one shared standard: the product should make
            sense the moment you see it—and earn its place after you use it.
          </p>
          <div
            className="feature-showcase__tabs"
            role="tablist"
            aria-label="Explore how Kelenate helps"
          >
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`showcase-tab-${item.id}`}
                aria-controls="showcase-panel"
                aria-selected={selected.id === item.id}
                tabIndex={selected.id === item.id ? 0 : -1}
                className={selected.id === item.id ? "active" : ""}
                onClick={() => setSelectedId(item.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.tab}
              </button>
            ))}
          </div>
        </div>

        <div
          className="feature-showcase__stage"
          id="showcase-panel"
          role="tabpanel"
          aria-labelledby={`showcase-tab-${selected.id}`}
        >
          <div className="feature-showcase__stage-head">
            <span>{product.category}</span>
            <span>Selected from the useful edit</span>
          </div>
          <button
            key={`${product.id}-image`}
            className="feature-showcase__image"
            type="button"
            onClick={() => onProduct(product)}
            aria-label={`View ${product.name}`}
          >
            <span className="feature-showcase__halo" aria-hidden="true" />
            <img
              src={product.image}
              alt={product.name}
              loading="lazy"
              decoding="async"
            />
          </button>
          <div key={`${product.id}-copy`} className="feature-showcase__product">
            <div>
              <p>{selected.note}</p>
              <h3>{product.name}</h3>
            </div>
            <div className="feature-showcase__product-bottom">
              <span>
                <strong>{formatCurrency(product.price)}</strong>
                <del>{formatCurrency(product.mrp)}</del>
              </span>
              <button type="button" onClick={() => onProduct(product)}>
                Explore product <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Shop({
  category,
  setCategory,
  query,
  setQuery,
  sort,
  setSort,
  searchRef,
  products,
  visibleCount,
  setVisibleCount,
  onProduct,
  onAdd,
  categories,
  wishlist,
  onToggleSave,
}) {
  return (
    <section className="section shop-section" id="shop" data-reveal>
      <div className="container">
        <SectionHeading
          eyebrow="The useful edit"
          title="Everyday favourites."
          copy="Real products, real specifications, and no marketplace clutter."
        />
        <div className="shop-toolbar">
          <div className="category-pills" aria-label="Filter products">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className={category === item ? "active" : ""}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="shop-controls">
            <label className="search-field">
              <Search size={18} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products"
                aria-label="Search products"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </label>
            <label className="sort-field">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label="Sort products"
              >
                <option value="featured">Featured</option>
                <option value="price-low">Price: low to high</option>
                <option value="price-high">Price: high to low</option>
                <option value="rating">Rating</option>
              </select>
              <ChevronDown size={15} />
            </label>
          </div>
        </div>

        {products.length ? (
          <>
            <div className="product-grid">
              {products.slice(0, visibleCount).map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onProduct={onProduct}
                  onAdd={onAdd}
                  saved={wishlist.includes(product.id)}
                  onToggleSave={onToggleSave}
                />
              ))}
            </div>
            {visibleCount < products.length && (
              <button
                className="button button-outline load-more"
                type="button"
                onClick={() => setVisibleCount((count) => count + 8)}
              >
                Show more products
                <ChevronDown size={18} />
              </button>
            )}
          </>
        ) : (
          <div className="empty-results">
            <Search size={30} />
            <h3>No exact matches yet</h3>
            <p>Try a shorter search or browse all products.</p>
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("All products");
              }}
            >
              View all products
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function RecentlyViewed({ products, onProduct, onAdd }) {
  return (
    <section
      className="recent-section"
      aria-labelledby="recent-title"
      data-reveal
    >
      <div className="container">
        <div className="recent-head">
          <span>
            <Clock3 size={19} />
          </span>
          <div>
            <p className="eyebrow">Picked up where you left off</p>
            <h2 id="recent-title">Recently viewed.</h2>
          </div>
          <p>Quickly return to products you were considering.</p>
        </div>
        <div className="recent-track">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onProduct={onProduct}
              onAdd={onAdd}
              compact
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductCard({
  product,
  onProduct,
  onAdd,
  saved = false,
  onToggleSave,
  compact = false,
}) {
  const soldOut = Number(product.inventory ?? 1) <= 0;
  return (
    <article className={`product-card ${compact ? "product-card--compact" : ""}`}>
      <a
        className="product-image-button"
        href={`/products/${encodeURIComponent(product.id)}`}
        onClick={(event) => {
          event.preventDefault();
          onProduct(product);
        }}
        aria-label={`View ${product.name}`}
      >
        <div className="product-badges">
          <span>{soldOut ? "Sold out" : product.badge}</span>
          <small>{discountPercent(product)}% off</small>
        </div>
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          decoding="async"
        />
        <span className="quick-view-label">
          View product <ArrowRight size={15} />
        </span>
      </a>
      <div className="product-info">
        <div className="product-meta-row">
          <p className="product-category">{product.category}</p>
          {onToggleSave && (
            <button
              className={`product-save ${saved ? "is-saved" : ""}`}
              type="button"
              onClick={() => onToggleSave(product)}
              aria-label={
                saved
                  ? `Remove ${product.name} from saved items`
                  : `Save ${product.name} for later`
              }
              aria-pressed={saved}
            >
              <Heart size={16} fill={saved ? "currentColor" : "none"} />
            </button>
          )}
        </div>
        <a
          className="product-name"
          href={`/products/${encodeURIComponent(product.id)}`}
          onClick={(event) => {
            event.preventDefault();
            onProduct(product);
          }}
        >
          {product.name}
        </a>
        <Rating product={product} />
        <div className="product-bottom">
          <p className="product-price">
            <strong>{formatCurrency(product.price)}</strong>
            <del>{formatCurrency(product.mrp)}</del>
          </p>
          <button
            className="add-button"
            type="button"
            onClick={() => onAdd(product)}
            disabled={soldOut}
            aria-label={`Add ${product.name} to cart`}
          >
            <Plus size={20} />
            <span>Add</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductPage({
  product,
  catalog,
  settings,
  onHome,
  onCategory,
  onAdd,
  onBuyNow,
  onProduct,
  saved,
  onToggleSave,
  onImagePreview,
  onNotify,
}) {
  const [quantity, setQuantity] = useState(1);
  const [showStickyBuy, setShowStickyBuy] = useState(false);
  const [pincode, setPincode] = useState("");
  const [deliveryState, setDeliveryState] = useState(null);
  const purchaseRef = useRef(null);
  const inventory = Number(product.inventory ?? 1);
  const soldOut = inventory <= 0;
  const lowStock = inventory > 0 && inventory <= 8;
  const related = [
    ...catalog.filter(
      (item) => item.id !== product.id && item.category === product.category,
    ),
    ...catalog.filter(
      (item) => item.id !== product.id && item.category !== product.category,
    ),
  ].slice(0, 4);
  const preferredPairings = (PRODUCT_PAIRINGS[product.id] || [])
    .map((productId) => catalog.find((item) => item.id === productId))
    .filter(Boolean);
  const frequentlyBought = [...preferredPairings, ...related]
    .filter(
      (item, index, items) =>
        Number(item.inventory ?? 1) > 0 &&
        items.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .slice(0, 2);

  useEffect(() => {
    const purchase = purchaseRef.current;
    if (!purchase || !window.IntersectionObserver) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setShowStickyBuy(
          !entry.isIntersecting && entry.boundingClientRect.top < 0,
        ),
      { threshold: 0.1 },
    );
    observer.observe(purchase);
    return () => observer.disconnect();
  }, [product.id]);

  const shareProduct = async () => {
    const shareData = {
      title: `${product.name} — Kelenate`,
      text: product.short,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(window.location.href);
      } else {
        const temporaryInput = document.createElement("input");
        temporaryInput.value = window.location.href;
        temporaryInput.style.position = "fixed";
        temporaryInput.style.opacity = "0";
        document.body.appendChild(temporaryInput);
        temporaryInput.select();
        document.execCommand("copy");
        temporaryInput.remove();
      }
      onNotify("Product link copied");
    } catch (error) {
      if (error?.name !== "AbortError") onNotify("Could not copy the link");
    }
  };

  const checkDelivery = (event) => {
    event.preventDefault();
    setDeliveryState(
      /^[1-9][0-9]{5}$/.test(pincode)
        ? "ready"
        : "invalid",
    );
  };

  return (
    <main className="product-page">
      <nav className="container product-breadcrumbs" aria-label="Breadcrumb">
        <button type="button" onClick={onHome}>
          Home
        </button>
        <ArrowRight size={13} />
        <button type="button" onClick={() => onCategory(product.category)}>
          {product.category}
        </button>
        <ArrowRight size={13} />
        <span>{product.name}</span>
      </nav>

      <section className="container pdp-hero">
        <div className="pdp-media">
          <button
            className="pdp-media__stage"
            type="button"
            onClick={() => onImagePreview(product)}
            aria-label={`Open larger image of ${product.name}`}
          >
            <div className="pdp-media__badges">
              <span>{soldOut ? "Sold out" : product.badge}</span>
              <small>{discountPercent(product)}% off</small>
            </div>
            <img
              src={product.image}
              alt={product.name}
              fetchPriority="high"
              decoding="async"
            />
            <span className="pdp-media__zoom">
              <ZoomIn size={16} />
              View larger
            </span>
          </button>
          <div className="pdp-media__caption">
            <span>
              <BadgeCheck size={17} />
              Kelenate catalog product
            </span>
            <span>ASIN / SKU: {product.asin || product.id}</span>
          </div>
        </div>

        <div className="pdp-summary">
          <div className="pdp-summary__topline">
            <div className="pdp-summary__eyebrow">
              <button type="button" onClick={() => onCategory(product.category)}>
                {product.category}
              </button>
              <span>Sold by Kelenate</span>
            </div>
            <div className="pdp-summary__actions">
              <button
                className={saved ? "is-saved" : ""}
                type="button"
                onClick={() => onToggleSave(product)}
                aria-label={saved ? "Remove from saved items" : "Save for later"}
                aria-pressed={saved}
              >
                <Heart size={17} fill={saved ? "currentColor" : "none"} />
                <span>{saved ? "Saved" : "Save"}</span>
              </button>
              <button type="button" onClick={shareProduct} aria-label="Share product">
                <Share2 size={17} />
                <span>Share</span>
              </button>
            </div>
          </div>
          <h1>{product.name}</h1>
          <p className="pdp-source-title">{product.sourceTitle}</p>
          <Rating product={product} />

          <div className="pdp-price">
            <strong>{formatCurrency(product.price)}</strong>
            <del>{formatCurrency(product.mrp)}</del>
            <span>You save {formatCurrency(product.mrp - product.price)}</span>
          </div>
          <p className="pdp-tax">Inclusive of all taxes</p>
          <p className="pdp-outcome">{outcomeFor(product)}</p>
          <p className="pdp-description">{product.short}</p>

          {product.highlights?.length > 0 && (
            <ul className="pdp-highlights">
              {product.highlights.slice(0, 4).map((highlight) => (
                <li key={highlight}>
                  <Check size={16} />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          )}

          <div
            className={`pdp-stock ${
              soldOut ? "is-sold-out" : lowStock ? "is-low-stock" : ""
            }`}
          >
            <span />
            {soldOut
              ? "Currently unavailable"
              : lowStock
                ? `Only ${inventory} left in this batch`
                : "In stock · normally dispatches in 1–2 business days"}
          </div>

          <form className="delivery-check" onSubmit={checkDelivery}>
            <MapPin size={19} />
            <div>
              <label htmlFor={`delivery-${product.id}`}>
                Check delivery before you buy
              </label>
              <div className="delivery-check__input">
                <input
                  id={`delivery-${product.id}`}
                  value={pincode}
                  onChange={(event) => {
                    setPincode(event.target.value.replace(/\D/g, "").slice(0, 6));
                    setDeliveryState(null);
                  }}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="Enter 6-digit PIN code"
                  aria-describedby={`delivery-note-${product.id}`}
                />
                <button type="submit">Check</button>
              </div>
              <small
                id={`delivery-note-${product.id}`}
                className={deliveryState ? `is-${deliveryState}` : ""}
              >
                {deliveryState === "ready" &&
                  "Estimated in 3–7 business days. Final courier serviceability is confirmed during order processing."}
                {deliveryState === "invalid" &&
                  "Please enter a valid 6-digit Indian PIN code."}
                {!deliveryState &&
                  "Get a quick estimate before choosing Buy now."}
              </small>
            </div>
          </form>

          <div className="pdp-purchase" ref={purchaseRef}>
            <Quantity
              value={quantity}
              onChange={setQuantity}
              label={`${product.name} quantity`}
              max={Math.min(10, Number(product.inventory ?? 10))}
            />
            <button
              className="button pdp-add"
              type="button"
              onClick={() => onAdd(product, quantity)}
              disabled={soldOut}
            >
              <ShoppingBag size={18} />
              {soldOut ? "Sold out" : "Add to cart"}
            </button>
            <button
              className="button pdp-buy-now"
              type="button"
              onClick={() => onBuyNow(product, quantity)}
              disabled={soldOut}
            >
              Buy now
              <ArrowRight size={18} />
            </button>
          </div>

          <div className="pdp-assurances" aria-label="Purchase protection">
            <div>
              <ShieldCheck size={19} />
              <span>
                <strong>Razorpay-secured payments</strong>
                <small className="pdp-payment-marks" aria-label="Payment methods">
                  <b>UPI</b>
                  <b>RuPay</b>
                  <b>Visa</b>
                </small>
              </span>
            </div>
            <div>
              <PackageCheck size={19} />
              <span>
                <strong>
                  {settings.returns.windowDays}-day returns & replacements
                </strong>
                Eligible unused or incorrect items
              </span>
            </div>
            <div>
              <Headphones size={19} />
              <span>
                <strong>Real Kelenate support</strong>
                {settings.support.hours}
              </span>
            </div>
          </div>
        </div>
      </section>

      {frequentlyBought.length > 0 && (
        <ProductCrossSell
          currentProduct={product}
          products={frequentlyBought}
          onProduct={onProduct}
          onAdd={onAdd}
        />
      )}

      <section className="product-detail-section">
        <div className="container product-detail-grid">
          <div className="product-detail-copy">
            <p className="eyebrow">Product details</p>
            <h2>Useful by design.</h2>
            <p>{product.short}</p>
            {product.highlights?.length > 0 && (
              <div className="product-feature-list">
                {product.highlights.map((highlight, index) => (
                  <article key={highlight}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <p>{highlight}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
          <div className="product-specifications">
            <div>
              <p className="eyebrow">At a glance</p>
              <h2>Specifications</h2>
            </div>
            {product.specs?.length ? (
              <dl>
                {product.specs.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
                <div>
                  <dt>Catalog reference</dt>
                  <dd>{product.asin || product.id}</dd>
                </div>
              </dl>
            ) : (
              <p className="product-specifications__empty">
                Detailed specifications for this product are being prepared.
                Contact support if you need a measurement before ordering.
              </p>
            )}
          </div>
        </div>
      </section>

      <ProductReviews product={product} />

      <section className="container product-service-strip">
        <div>
          <CreditCard size={21} />
          <span>
            <strong>Flexible payment</strong>
            Online or cash on delivery
          </span>
        </div>
        <div>
          <Truck size={21} />
          <span>
            <strong>Pan-India delivery</strong>
            Tracked after dispatch
          </span>
        </div>
        <div>
          <Headphones size={21} />
          <span>
            <strong>Human support</strong>
            {settings.support.hours}
          </span>
        </div>
      </section>

      {related.length > 0 && (
        <section className="section product-related">
          <div className="container">
            <SectionHeading
              eyebrow="You may also need"
              title="Useful additions."
              copy="More practical products from the Kelenate catalog."
            />
            <div className="product-grid">
              {related.map((item) => (
                <ProductCard
                  key={item.id}
                  product={item}
                  onProduct={onProduct}
                  onAdd={onAdd}
                  saved={false}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {!soldOut && showStickyBuy && (
        <div className="pdp-mobile-buy">
          <span>
            <small>{product.name}</small>
            <strong>{formatCurrency(product.price)}</strong>
          </span>
          <button type="button" onClick={() => onAdd(product, quantity)}>
            Add to cart
          </button>
        </div>
      )}
    </main>
  );
}

function CompactRecommendation({ product, onProduct, onAdd }) {
  return (
    <div className="cart-recommendation__product">
      <button
        className="cart-recommendation__image"
        type="button"
        onClick={() => onProduct(product)}
        aria-label={`View ${product.name}`}
      >
        <img src={product.image} alt="" decoding="async" />
      </button>
      <button
        className="cart-recommendation__copy"
        type="button"
        onClick={() => onProduct(product)}
      >
        <strong>{product.name}</strong>
        <span>
          {formatCurrency(product.price)}
          {product.mrp > product.price && (
            <small>Save {formatCurrency(product.mrp - product.price)}</small>
          )}
        </span>
      </button>
      <button
        className="cart-recommendation__add"
        type="button"
        onClick={() => onAdd(product)}
        aria-label={`Add ${product.name} to cart`}
      >
        <Plus size={16} /> Add
      </button>
    </div>
  );
}

function ProductCrossSell({
  currentProduct,
  products,
  onProduct,
  onAdd,
}) {
  return (
    <section className="pdp-cross-sell" aria-labelledby="cross-sell-title">
      <div className="container pdp-cross-sell__inner">
        <div className="pdp-cross-sell__heading">
          <p className="eyebrow">Complete the setup</p>
          <h2 id="cross-sell-title">Frequently bought with</h2>
          <p>
            Practical additions for the same job as {currentProduct.name}.
            Items are added individually—no bundle discount is being claimed.
          </p>
        </div>
        <div className="pdp-cross-sell__products">
          {products.map((product) => (
            <article key={product.id}>
              <CompactRecommendation
                product={product}
                onProduct={onProduct}
                onAdd={onAdd}
              />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductReviews({ product }) {
  const writtenReviews = Array.isArray(product.customerReviews)
    ? product.customerReviews
    : [];
  const marketplaceUrl = product.asin
    ? `https://www.amazon.in/dp/${encodeURIComponent(product.asin)}`
    : null;

  return (
    <section className="pdp-reviews" aria-labelledby="pdp-reviews-title">
      <div className="container">
        <div className="pdp-reviews__heading">
          <div>
            <p className="eyebrow">Customer reviews</p>
            <h2 id="pdp-reviews-title">Proof, with the source shown.</h2>
          </div>
          <p>
            Marketplace ratings stay separate from direct-site reviews, so you
            always know what the number represents.
          </p>
        </div>

        <div className="pdp-reviews__grid">
          <aside className="pdp-rating-summary">
            {product.rating ? (
              <>
                <strong>{product.rating.toFixed(1)}</strong>
                <div className="pdp-rating-summary__stars" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((starIndex) => (
                    <Star
                      key={starIndex}
                      size={18}
                      fill={
                        starIndex < Math.round(product.rating)
                          ? "currentColor"
                          : "none"
                      }
                    />
                  ))}
                </div>
                <span>
                  {product.reviews} marketplace{" "}
                  {product.reviews === 1 ? "rating" : "ratings"}
                </span>
                <small>
                  Imported from the Amazon listing. Last marketplace audit:
                  23 July 2026.
                </small>
              </>
            ) : (
              <>
                <Sparkles size={26} />
                <strong className="pdp-rating-summary__new">New listing</strong>
                <span>No marketplace rating imported yet</span>
                <small>
                  We do not display a placeholder score for unrated products.
                </small>
              </>
            )}
            {marketplaceUrl && (
              <a href={marketplaceUrl} target="_blank" rel="noreferrer">
                View the source listing <ArrowRight size={15} />
              </a>
            )}
          </aside>

          <div className="pdp-written-reviews">
            {writtenReviews.length > 0 ? (
              writtenReviews.map((review) => (
                <article key={`${review.name}-${review.date || review.title}`}>
                  <div>
                    <strong>{review.name}</strong>
                    <span>
                      {review.rating}/5
                      {review.verified ? " · Verified purchase" : ""}
                    </span>
                  </div>
                  <h3>{review.title}</h3>
                  <p>{review.body}</p>
                  <small>
                    {review.source || "Kelenate customer"}
                    {review.date ? ` · ${review.date}` : ""}
                  </small>
                </article>
              ))
            ) : (
              <div className="pdp-written-reviews__empty">
                <BadgeCheck size={28} />
                <p className="eyebrow">Written review status</p>
                <h3>No unverified quotes.</h3>
                <p>
                  Named written reviews have not yet been imported for this
                  listing. Until Kelenate supplies an approved marketplace
                  export or a verified direct buyer submits feedback, we show
                  the real aggregate above without generating testimonial copy.
                </p>
                <span>
                  Verified written reviews will appear here with a name, source
                  and purchase status.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ProductRouteState({ loading, onHome }) {
  return (
    <main className="product-route-state">
      {loading ? (
        <>
          <LoaderCircle className="product-route-state__loader" size={30} />
          <h1>Loading product…</h1>
          <p>Fetching the latest catalog information.</p>
        </>
      ) : (
        <>
          <PackageCheck size={35} />
          <h1>That product isn’t available.</h1>
          <p>It may have moved or is no longer listed in the active catalog.</p>
          <button className="button button-primary" type="button" onClick={onHome}>
            Return to the store <ArrowRight size={17} />
          </button>
        </>
      )}
    </main>
  );
}

function Rating({ product, light = false }) {
  if (!product.rating) {
    return (
      <div className={`rating rating-new ${light ? "rating-light" : ""}`}>
        <Sparkles size={14} />
        New arrival
      </div>
    );
  }
  return (
    <div className={`rating ${light ? "rating-light" : ""}`}>
      <Star size={14} fill="currentColor" />
      <strong>{product.rating.toFixed(1)}</strong>
      <span className="rating-source">
        {product.reviews} ratings — imported from Amazon
      </span>
    </div>
  );
}

function QuickView({ product, onClose, onAdd, settings, onProduct }) {
  const [quantity, setQuantity] = useState(1);
  const soldOut = Number(product.inventory ?? 1) <= 0;
  return (
    <div className="modal-wrap" role="presentation">
      <button
        className="overlay-backdrop"
        type="button"
        aria-label="Close product"
        onClick={onClose}
      />
      <div
        className="quick-view-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-view-title"
      >
        <button
          className="modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close product"
        >
          <X size={21} />
        </button>
        <div className="quick-image">
          <span>{product.badge}</span>
            <img
              src={product.image}
              alt={product.name}
              decoding="async"
            />
        </div>
        <div className="quick-copy">
          <p className="eyebrow">{product.category}</p>
          <h2 id="quick-view-title">{product.name}</h2>
          <Rating product={product} />
          <p className="quick-description">{product.short}</p>
          <p className="quick-price">
            <strong>{formatCurrency(product.price)}</strong>
            <del>{formatCurrency(product.mrp)}</del>
            <span>Save {formatCurrency(product.mrp - product.price)}</span>
          </p>
          <div className="tax-note">Inclusive of all taxes</div>
          <ul className="highlight-list">
            {product.highlights.map((highlight) => (
              <li key={highlight}>
                <Check size={16} />
                {highlight}
              </li>
            ))}
          </ul>
          <div className="spec-grid">
            {product.specs.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="quick-actions">
            <Quantity
              value={quantity}
              onChange={setQuantity}
              label="Product quantity"
              max={Math.min(10, Number(product.inventory ?? 10))}
            />
            <button
              className="button button-primary quick-add"
              type="button"
              onClick={() => onAdd(product, quantity)}
              disabled={soldOut}
            >
              {soldOut
                ? "Currently sold out"
                : `Add to cart · ${formatCurrency(product.price * quantity)}`}
            </button>
          </div>
          <button
            className="quick-full-details"
            type="button"
            onClick={() => onProduct(product)}
          >
            See full product details <ArrowRight size={16} />
          </button>
          <div className="quick-delivery">
            <Truck size={18} />
            <p>
              <strong>
                Free delivery on{" "}
                {formatCurrency(settings.shipping.freeThreshold)}+
              </strong>
              <span>Usually delivered in 3–7 business days</span>
            </p>
          </div>
          <p className="source-note">Catalog reference: ASIN {product.asin}</p>
        </div>
      </div>
    </div>
  );
}

function Quantity({ value, onChange, label, max = 10 }) {
  return (
    <div className="quantity" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        aria-label="Decrease quantity"
      >
        <Minus size={15} />
      </button>
      <span>{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Increase quantity"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

function CartDrawer({
  open,
  onClose,
  items,
  subtotal,
  shipping,
  total,
  onUpdate,
  onCheckout,
  shippingSettings,
  recommendation,
  onAdd,
  onProduct,
}) {
  if (!open) return null;
  const threshold = Number(shippingSettings.freeThreshold);
  const remaining = Math.max(0, threshold - subtotal);
  const progress =
    threshold === 0 ? 100 : Math.min(100, (subtotal / threshold) * 100);

  return (
    <div className="drawer-wrap">
      <button
        className="overlay-backdrop"
        type="button"
        aria-label="Close cart"
        onClick={onClose}
      />
      <aside className="cart-drawer" aria-label="Shopping cart">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Your selection</p>
            <h2>Shopping cart</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close cart"
          >
            <X size={22} />
          </button>
        </div>

        {items.length ? (
          <>
            <div className="shipping-progress">
              <div>
                <Truck size={17} />
                {remaining > 0 ? (
                  <span>
                    Add <strong>{formatCurrency(remaining)}</strong> for free
                    delivery
                  </span>
                ) : (
                  <span>
                    <strong>You unlocked free delivery</strong>
                  </span>
                )}
              </div>
              <span className="progress-track">
                <span style={{ width: `${progress}%` }} />
              </span>
            </div>

            <div className="cart-items">
              {items.map(({ product, quantity }) => (
                <div className="cart-item" key={product.id}>
                  <img src={product.image} alt="" />
                  <div className="cart-item-copy">
                    <strong>{product.name}</strong>
                    <small>{product.category}</small>
                    <div>
                      <Quantity
                        value={quantity}
                        onChange={(next) => onUpdate(product.id, next)}
                        label={`${product.name} quantity`}
                        max={Math.min(10, Number(product.inventory ?? 10))}
                      />
                      <button
                        className="remove-button"
                        type="button"
                        onClick={() => onUpdate(product.id, 0)}
                        aria-label={`Remove ${product.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="cart-line-total">
                    <small>Line total</small>
                    <strong>{formatCurrency(product.price * quantity)}</strong>
                  </div>
                </div>
              ))}
            </div>

            {remaining > 0 && recommendation && (
              <div className="cart-recommendation">
                <div className="cart-recommendation__head">
                  <span>One more useful thing</span>
                  <small>Closer to free delivery</small>
                </div>
                <CompactRecommendation
                  product={recommendation}
                  onProduct={onProduct}
                  onAdd={onAdd}
                />
              </div>
            )}

            <div className="drawer-summary">
              <div>
                <span>Subtotal</span>
                <strong>{formatCurrency(subtotal)}</strong>
              </div>
              <div>
                <span>Shipping</span>
                <strong className={shipping === 0 ? "free-text" : ""}>
                  {shipping === 0 ? "FREE" : formatCurrency(shipping)}
                </strong>
              </div>
              <div className="summary-total">
                <span>Total</span>
                <strong>{formatCurrency(total)}</strong>
              </div>
              <small>Taxes included. Final delivery is checked at checkout.</small>
              <button
                className="button button-primary checkout-button"
                type="button"
                onClick={onCheckout}
              >
                Secure checkout <ArrowRight size={18} />
              </button>
              <div className="payment-row">
                <span>UPI</span>
                <span>RuPay</span>
                <span>Visa</span>
                <span>COD</span>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-cart">
            <div>
              <ShoppingBag size={31} />
            </div>
            <h3>Your cart is ready for something useful.</h3>
            <p>Explore practical favourites starting at ₹199.</p>
            <button
              className="button button-primary"
              type="button"
              onClick={onClose}
            >
              Continue shopping
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

function CheckoutSteps({ activeStep }) {
  const steps = ["Cart", "Details", "Payment"];
  return (
    <ol className="checkout-steps" aria-label="Checkout progress">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const complete = stepNumber < activeStep;
        const active = stepNumber === activeStep;
        return (
          <li
            key={step}
            className={`${complete ? "is-complete" : ""} ${
              active ? "is-active" : ""
            }`}
            aria-current={active ? "step" : undefined}
          >
            <span>{complete ? <Check size={14} /> : stepNumber}</span>
            <strong>{step}</strong>
          </li>
        );
      })}
    </ol>
  );
}

function CheckoutField({
  label,
  name,
  value,
  error,
  note,
  noteTone,
  wide = false,
  onChange,
  onBlur,
  ...inputProps
}) {
  const inputId = `checkout-${name}`;
  const messageId = `${inputId}-message`;
  return (
    <label
      className={`field ${wide ? "field-wide" : ""} ${
        error ? "has-error" : ""
      }`}
    >
      <span>{label}</span>
      <input
        {...inputProps}
        id={inputId}
        name={name}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={error || note ? messageId : undefined}
      />
      {(error || note) && (
        <small
          id={messageId}
          className={error ? "field-error" : `field-note is-${noteTone || "info"}`}
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
        >
          {error || note}
        </small>
      )}
    </label>
  );
}

function Checkout({
  items,
  subtotal,
  shipping,
  total,
  settings,
  onUpdate,
  onClose,
  onComplete,
}) {
  const [paymentMethod, setPaymentMethod] = useState("online");
  const [customer, setCustomer] = useState(storedCheckoutDetails);
  const [touched, setTouched] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const autoFilledLocation = useRef({ city: "", state: "" });
  const [pincodeStatus, setPincodeStatus] = useState("idle");
  const [pincodeResult, setPincodeResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    const hasDraft = CHECKOUT_FIELD_NAMES.some((field) => customer[field]);
    if (hasDraft) {
      sessionStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(customer));
    } else {
      sessionStorage.removeItem(CHECKOUT_DRAFT_KEY);
    }
  }, [customer]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector("#checkout-name")?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.requestAnimationFrame(() => {
        const fallback = document.querySelector(
          'button[aria-label^="Open cart with"]',
        );
        const focusTarget =
          previousFocus instanceof HTMLElement &&
          previousFocus !== document.body &&
          previousFocus.isConnected
            ? previousFocus
            : fallback;
        focusTarget?.focus();
      });
    };
  }, []);

  useEffect(() => {
    if (!busy) return undefined;
    const keepCheckoutOpen = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", keepCheckoutOpen, true);
    return () => window.removeEventListener("keydown", keepCheckoutOpen, true);
  }, [busy]);

  useEffect(() => {
    const pincode = customer.pincode;
    setPincodeResult(null);
    if (!pincode) {
      setPincodeStatus("idle");
      return undefined;
    }
    if (pincode.length < 6) {
      setPincodeStatus("typing");
      return undefined;
    }
    if (!/^[1-9]\d{5}$/.test(pincode)) {
      setPincodeStatus("invalid");
      setFieldErrors((current) => ({
        ...current,
        pincode: "Enter a valid 6-digit Indian PIN code.",
      }));
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPincodeStatus("checking");
      lookupPincode(pincode, { signal: controller.signal })
        .then((lookup) => {
          setPincodeStatus("valid");
          setPincodeResult(lookup);
          setCustomer((current) => {
            if (current.pincode !== pincode) return current;
            const previous = autoFilledLocation.current;
            const city =
              !current.city.trim() || current.city === previous.city
                ? lookup.city || current.city
                : current.city;
            const state =
              !current.state.trim() || current.state === previous.state
                ? lookup.state || current.state
                : current.state;
            autoFilledLocation.current = {
              city: lookup.city || "",
              state: lookup.state || "",
            };
            return { ...current, city, state };
          });
          setFieldErrors((current) => {
            const next = { ...current };
            delete next.pincode;
            delete next.city;
            delete next.state;
            return next;
          });
        })
        .catch((lookupError) => {
          if (lookupError.name === "AbortError") return;
          if (lookupError.code === "PINCODE_NOT_FOUND") {
            setPincodeStatus("invalid");
            setFieldErrors((current) => ({
              ...current,
              pincode: lookupError.message,
            }));
            return;
          }
          setPincodeStatus("unavailable");
        });
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [customer.pincode]);

  const detailsComplete =
    CHECKOUT_FIELD_NAMES.every(
      (field) => !checkoutFieldError(field, customer[field]),
    ) && ["valid", "unavailable"].includes(pincodeStatus);
  const activeStep = detailsComplete ? 3 : 2;

  const updateCustomer = (event) => {
    const { name } = event.target;
    const value = ["phone", "pincode"].includes(name)
      ? event.target.value.replace(/\D/g, "").slice(0, name === "phone" ? 10 : 6)
      : event.target.value;
    setCustomer((current) => ({ ...current, [name]: value }));
    setError("");
    if (touched[name] || fieldErrors[name]) {
      setFieldErrors((current) => ({
        ...current,
        [name]: checkoutFieldError(name, value),
      }));
    }
  };

  const blurCustomerField = (event) => {
    const { name, value } = event.target;
    setTouched((current) => ({ ...current, [name]: true }));
    setFieldErrors((current) => ({
      ...current,
      [name]: checkoutFieldError(name, value),
    }));
  };

  const validateDetails = () => {
    const nextErrors = CHECKOUT_FIELD_NAMES.reduce((errors, field) => {
      const message = checkoutFieldError(field, customer[field]);
      if (message) errors[field] = message;
      return errors;
    }, {});
    if (pincodeStatus === "invalid") {
      nextErrors.pincode =
        fieldErrors.pincode || "We could not validate that PIN code.";
    }
    setTouched(
      CHECKOUT_FIELD_NAMES.reduce(
        (fields, field) => ({ ...fields, [field]: true }),
        {},
      ),
    );
    setFieldErrors(nextErrors);
    const firstInvalid = CHECKOUT_FIELD_NAMES.find(
      (field) => nextErrors[field],
    );
    if (firstInvalid) {
      window.requestAnimationFrame(() =>
        document.getElementById(`checkout-${firstInvalid}`)?.focus(),
      );
    }
    return !firstInvalid;
  };

  const requestClose = () => {
    if (!busy) onClose();
  };

  const handleDialogKeyDown = (event) => {
    if (event.key !== "Tab") return;
    const focusable = [
      ...dialogRef.current.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    if (!validateDetails()) return;
    if (["idle", "typing", "checking"].includes(pincodeStatus)) {
      setError("Please wait a moment while we validate your PIN code.");
      return;
    }

    setBusy(true);
    try {
      const order = await submitCheckout({
        customer: CHECKOUT_FIELD_NAMES.reduce(
          (details, field) => ({
            ...details,
            [field]: customer[field].trim(),
          }),
          {},
        ),
        items: items.map(({ product, quantity }) => ({
          id: product.id,
          asin: product.asin,
          name: product.name,
          price: product.price,
          quantity,
        })),
        totals: { subtotal, shipping, total },
        paymentMethod,
      });
      sessionStorage.removeItem(CHECKOUT_DRAFT_KEY);
      setResult(order);
      onComplete();
    } catch (checkoutError) {
      setError(checkoutError.message || "Checkout could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const pincodeNote =
    pincodeStatus === "typing"
      ? "Enter all 6 digits to auto-fill city and state."
      : pincodeStatus === "checking"
        ? "Checking this PIN code…"
        : pincodeStatus === "valid"
          ? `${pincodeResult?.city}, ${pincodeResult?.state} found. Please verify the auto-filled details.`
          : pincodeStatus === "unavailable"
            ? "Auto-fill is temporarily unavailable. Enter city and state manually."
            : "";
  const pincodeNoteTone =
    pincodeStatus === "valid"
      ? "success"
      : pincodeStatus === "unavailable"
        ? "warning"
        : "info";

  return (
    <div className="modal-wrap">
      <button
        className="overlay-backdrop"
        type="button"
        aria-label="Close checkout"
        onClick={requestClose}
        disabled={busy}
      />
      <div
        className="checkout-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        aria-busy={busy}
        ref={dialogRef}
        onKeyDown={handleDialogKeyDown}
      >
        <button
          className="modal-close"
          type="button"
          onClick={requestClose}
          disabled={busy}
          aria-label="Close checkout"
        >
          <X size={21} />
        </button>

        {result ? (
          <div className="order-result">
            <div className="result-check">
              <Check size={32} />
            </div>
            <p className="eyebrow">
              {result.preview ? "Checkout preview complete" : "Order confirmed"}
            </p>
            <h2>{result.preview ? "The order flow works." : "Thank you!"}</h2>
            <p>{result.message || "Your order has been received."}</p>
            <div className="order-number">
              <span>Order reference</span>
              <strong>{result.orderId}</strong>
            </div>
            {result.preview && (
              <div className="preview-explainer">
                <Zap size={18} />
                <span>
                  Razorpay and Shiprocket credentials are still required before
                  this storefront can accept real orders.
                </span>
              </div>
            )}
            <button
              className="button button-primary"
              type="button"
              onClick={onClose}
            >
              Return to store
            </button>
          </div>
        ) : (
          <>
            <CheckoutSteps activeStep={activeStep} />
            <div className="checkout-grid">
              <form
                className="checkout-form"
                onSubmit={handleSubmit}
                noValidate
              >
                <div className="checkout-title">
                  <p className="eyebrow">Secure checkout</p>
                  <h2 id="checkout-title">Where should we send it?</h2>
                  {!commerceConfigured && (
                    <span className="preview-pill">
                      <Zap size={14} /> Preview mode
                    </span>
                  )}
                </div>
                <div className="form-section">
                  <h3>Contact</h3>
                  <div className="field-grid">
                    <CheckoutField
                      label="Full name"
                      name="name"
                      value={customer.name}
                      error={fieldErrors.name}
                      onChange={updateCustomer}
                      onBlur={blurCustomerField}
                      autoComplete="name"
                      wide
                    />
                    <CheckoutField
                      label="Mobile number"
                      name="phone"
                      value={customer.phone}
                      error={fieldErrors.phone}
                      onChange={updateCustomer}
                      onBlur={blurCustomerField}
                      inputMode="numeric"
                      autoComplete="tel"
                    />
                    <CheckoutField
                      label="Email"
                      name="email"
                      value={customer.email}
                      error={fieldErrors.email}
                      onChange={updateCustomer}
                      onBlur={blurCustomerField}
                      type="email"
                      autoComplete="email"
                    />
                  </div>
                </div>
                <div className="form-section">
                  <h3>Delivery address</h3>
                  <div className="field-grid">
                    <CheckoutField
                      label="Flat, house, building"
                      name="address"
                      value={customer.address}
                      error={fieldErrors.address}
                      onChange={updateCustomer}
                      onBlur={blurCustomerField}
                      autoComplete="address-line1"
                      wide
                    />
                    <CheckoutField
                      label="Area, road, landmark"
                      name="area"
                      value={customer.area}
                      error={fieldErrors.area}
                      onChange={updateCustomer}
                      onBlur={blurCustomerField}
                      autoComplete="address-line2"
                      wide
                    />
                    <CheckoutField
                      label="PIN code"
                      name="pincode"
                      value={customer.pincode}
                      error={fieldErrors.pincode}
                      note={pincodeNote}
                      noteTone={pincodeNoteTone}
                      onChange={updateCustomer}
                      onBlur={blurCustomerField}
                      inputMode="numeric"
                      autoComplete="postal-code"
                      wide
                    />
                    <CheckoutField
                      label="City / district"
                      name="city"
                      value={customer.city}
                      error={fieldErrors.city}
                      onChange={updateCustomer}
                      onBlur={blurCustomerField}
                      autoComplete="address-level2"
                    />
                    <CheckoutField
                      label="State"
                      name="state"
                      value={customer.state}
                      error={fieldErrors.state}
                      onChange={updateCustomer}
                      onBlur={blurCustomerField}
                      autoComplete="address-level1"
                    />
                  </div>
                  <p className="checkout-draft-note">
                    Details are kept only in this browser tab, so closing
                    checkout does not erase your progress.
                  </p>
                </div>
                <div className="form-section checkout-payment-section">
                  <h3>Payment</h3>
                  <div className="payment-options">
                    <label
                      className={paymentMethod === "online" ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value="online"
                        checked={paymentMethod === "online"}
                        onChange={() => setPaymentMethod("online")}
                      />
                      <span className="payment-icon">
                        <CreditCard size={20} />
                      </span>
                      <span className="payment-option-copy">
                        <span className="payment-option-heading">
                          <strong>Pay online</strong>
                          <em>Instant confirmation</em>
                        </span>
                        <small>
                          UPI, cards and net banking · secured by Razorpay
                        </small>
                        <span className="payment-benefits">
                          <b>₹0 payment fee</b>
                          <b>Same delivery charge</b>
                        </span>
                      </span>
                      <i>{paymentMethod === "online" && <Check size={15} />}</i>
                    </label>
                    <label
                      className={paymentMethod === "cod" ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value="cod"
                        checked={paymentMethod === "cod"}
                        onChange={() => setPaymentMethod("cod")}
                      />
                      <span className="payment-icon">
                        <Banknote size={20} />
                      </span>
                      <span className="payment-option-copy">
                        <span className="payment-option-heading">
                          <strong>Cash on delivery</strong>
                          <em>Pay at your door</em>
                        </span>
                        <small>Pay the courier when your parcel arrives</small>
                        <span className="payment-benefits">
                          <b>₹0 COD fee</b>
                          <b>Courier confirmation required</b>
                        </span>
                      </span>
                      <i>{paymentMethod === "cod" && <Check size={15} />}</i>
                    </label>
                  </div>
                  <div
                    className={`payment-comparison is-${paymentMethod}`}
                    aria-live="polite"
                  >
                    <CheckCircle2 size={18} />
                    <p>
                      <strong>
                        {paymentMethod === "online"
                          ? "Choose online for immediate payment confirmation."
                          : "Choose COD if you prefer paying after the parcel arrives."}
                      </strong>{" "}
                      {paymentMethod === "online"
                        ? "There is currently no additional payment fee."
                        : "Final COD availability depends on courier serviceability for your PIN code and is confirmed during order processing."}
                    </p>
                  </div>
                  <div className="checkout-payment-reassurance">
                    <ShieldCheck size={18} />
                    <p>
                      <strong>
                        {paymentMethod === "online"
                          ? "Online payment is processed securely by Razorpay."
                          : "No online payment is collected for a COD order."}
                      </strong>
                      Eligible returns or replacements can be requested within{" "}
                      {settings.returns.windowDays} days. Approved refunds
                      generally reflect within 5–7 business days.
                    </p>
                  </div>
                </div>
                {error && (
                  <div className="checkout-error" role="alert">
                    {error}
                  </div>
                )}
                <button
                  className="button button-primary place-order"
                  type="submit"
                  disabled={busy || pincodeStatus === "checking"}
                >
                  {busy
                    ? "Starting secure checkout…"
                    : pincodeStatus === "checking"
                      ? "Checking PIN code…"
                      : commerceConfigured
                        ? `Place order · ${formatCurrency(total)}`
                        : `Preview order · ${formatCurrency(total)}`}
                  {!busy && pincodeStatus !== "checking" && (
                    <LockKeyhole size={17} />
                  )}
                </button>
                <p className="checkout-consent">
                  By continuing, you agree to the store terms and return policy.
                </p>
              </form>
              <aside className="checkout-summary">
                <p className="eyebrow">Order summary</p>
                <div className="checkout-items">
                  {items.map(({ product, quantity }) => (
                    <div key={product.id}>
                      <span className="checkout-thumb">
                        <img src={product.image} alt="" />
                        <b>{quantity}</b>
                      </span>
                      <div className="checkout-item-copy">
                        <strong>{product.name}</strong>
                        <small>{product.category}</small>
                        <div className="checkout-item-actions">
                          <Quantity
                            value={quantity}
                            onChange={(next) => onUpdate(product.id, next)}
                            label={`${product.name} checkout quantity`}
                            max={Math.min(
                              10,
                              Number(product.inventory ?? 10),
                            )}
                          />
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onUpdate(product.id, 0)}
                              aria-label={`Remove ${product.name} from order`}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="checkout-item-total">
                        <small>Line total</small>
                        <strong>
                          {formatCurrency(product.price * quantity)}
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="checkout-totals">
                  <p>
                    <span>Subtotal</span>
                    <strong>{formatCurrency(subtotal)}</strong>
                  </p>
                  <p>
                    <span>Shipping</span>
                    <strong>{shipping ? formatCurrency(shipping) : "FREE"}</strong>
                  </p>
                  <p>
                    <span>Total</span>
                    <strong>{formatCurrency(total)}</strong>
                  </p>
                </div>
                <div className="secure-note">
                  <ShieldCheck size={19} />
                  <span>
                    <strong>Secure transaction</strong>
                    {paymentMethod === "online"
                      ? "Payment details are handled by Razorpay."
                      : "Payment is collected by the courier at delivery."}
                  </span>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BrandStory() {
  return (
    <section className="section story-section" id="story" data-reveal>
      <div className="container story-grid">
        <div className="story-visual">
          <div className="story-image story-image-main">
            <img
              src="/products/number-alphabet-labels.jpg"
              alt=""
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="story-image story-image-small">
            <img
              src="/products/reflective-stripes.jpg"
              alt=""
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="story-stamp">
            <strong>15</strong>
            <span>years of learning from real orders</span>
          </div>
        </div>
        <div className="story-copy">
          <p className="eyebrow">About Kelenate</p>
          <h2>Useful by design.</h2>
          <p className="story-lead">
            We make practical products that solve small, everyday problems—and
            keep improving them with every batch.
          </p>
          <p>
            From protective car accents to habit trackers and shipping labels,
            our catalog is united by one idea: useful products should be clear,
            dependable and fairly priced.
          </p>
          <div className="story-values">
            <div>
              <span>
                <BadgeCheck size={20} />
              </span>
              <p>
                <strong>Honest quality</strong>
                Clean prints, proper materials and no unnecessary fluff.
              </p>
            </div>
            <div>
              <span>
                <PackageCheck size={20} />
              </span>
              <p>
                <strong>Careful packing</strong>
                Packed to arrive crisp, protected and ready to use.
              </p>
            </div>
            <div>
              <span>
                <Heart size={20} />
              </span>
              <p>
                <strong>Continuously improved</strong>
                Buyer feedback shapes what we make next.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MarketplaceProof({ catalog, onQuickView }) {
  const products = [
    catalog.find((product) => product.id === "habit-tracker"),
    catalog.find((product) => product.id === "reflective-stripes"),
    catalog.find((product) => product.id === "door-edge-guard"),
  ].filter(Boolean);
  return (
    <section className="section proof-section" data-reveal>
      <div className="container">
        <div className="proof-head">
          <div>
            <p className="eyebrow">Marketplace rating snapshot</p>
            <h2>Existing product track records.</h2>
          </div>
          <p>
            Aggregate scores are imported from existing Amazon product
            listings. Listing totals may include product variants.
          </p>
        </div>
        <div className="proof-grid">
          {products.map((product, index) => (
            <button
              type="button"
              className="proof-card"
              key={product.id}
              onClick={() => onQuickView(product)}
            >
              <div className="proof-stars">
                {Array.from({ length: 5 }).map((_, starIndex) => (
                  <Star
                    key={starIndex}
                    size={15}
                    fill={starIndex < Math.round(product.rating) ? "currentColor" : "none"}
                  />
                ))}
              </div>
              <p className="proof-listing-note">
                Aggregate marketplace score for this product listing
                {index === 0 ? " and its listed variants." : "."}
              </p>
              <div>
                <img
                  src={product.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span>
                  <strong>{product.name}</strong>
                  <small>
                    {product.rating.toFixed(1)} · {product.reviews} ratings —
                    imported from Amazon
                  </small>
                </span>
                <ArrowRight size={18} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq({ settings }) {
  const questions = [
    [
      "When is shipping free?",
      `Shipping is free when the product subtotal is ${formatCurrency(settings.shipping.freeThreshold)} or more. Smaller orders carry a flat ${formatCurrency(settings.shipping.standardFee)} delivery charge.`,
    ],
    [
      "How long will delivery take?",
      "Orders are usually dispatched within 1–2 business days and delivered in 3–7 business days, depending on the PIN code and courier serviceability.",
    ],
    [
      "Can I pay cash on delivery?",
      "You can request COD at checkout. Final availability depends on courier serviceability for your PIN code and is confirmed during order processing. Online payments through UPI, cards, wallets and net banking are processed securely by Razorpay.",
    ],
    [
      "Will a car accessory fit my vehicle?",
      "Check the dimensions and fit notes on the product page before ordering. Products marked universal fit work across most vehicles but installation surfaces and available space can differ.",
    ],
    [
      "What if an item arrives damaged?",
      "Contact us within 48 hours of delivery with your order number and clear photographs. Eligible damaged, defective or incorrect items are replaced or refunded after verification.",
    ],
    [
      "Do I receive a GST invoice?",
      "Yes. A tax invoice is issued with every order using the billing information supplied during checkout.",
    ],
  ];
  return (
    <section className="section faq-section" id="faq" data-reveal>
      <div className="container faq-grid">
        <div className="faq-intro">
          <p className="eyebrow">Questions, answered</p>
          <h2>Good to know.</h2>
          <p>
            Still unsure about a product or fit? Our team can help before you
            order.
          </p>
          <a
            className="button button-outline"
            href={`https://wa.me/${settings.support.whatsapp}`}
            target="_blank"
            rel="noreferrer"
          >
            Ask on WhatsApp <ArrowRight size={17} />
          </a>
        </div>
        <div className="faq-list">
          {questions.map(([question, answer], index) => (
            <FaqItem
              key={question}
              question={question}
              answer={answer}
              defaultOpen={index === 0}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqItem({ question, answer, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const answerId = useId();
  return (
    <div className={`faq-item ${open ? "open" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={answerId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{question}</span>
        <Plus size={19} />
      </button>
      <div
        className="faq-answer"
        id={answerId}
        role="region"
        aria-label={question}
      >
        <p>{answer}</p>
      </div>
    </div>
  );
}

function SupportBand({ settings }) {
  return (
    <section className="support-band">
      <div className="container support-inner">
        <div>
          <span className="support-icon">
            <CircleHelp size={24} />
          </span>
          <p>
            <strong>Need help choosing?</strong>
            Talk to a real person before you order.
          </p>
        </div>
        <div className="support-actions">
          <a href={phoneLink(settings.support.phone)}>
            <Phone size={17} /> {settings.support.phone}
          </a>
          <a href={`mailto:${settings.support.email}`}>
            <Mail size={17} /> {settings.support.email}
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer({ onPolicy, onCategory, categories, settings }) {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <span className="footer-logo">
            <img src="/brand/kelenate-logo.jpeg" alt="Kelenate" />
          </span>
          <p>
            Practical products for cars, homes, routines and small businesses.
          </p>
          <div className="footer-contact">
            <span>
              <MapPin size={16} />
              Wazirpur Industrial Area, Delhi 110052
            </span>
            <span>
              <Mail size={16} />
              {settings.support.email}
            </span>
          </div>
        </div>
        <div className="footer-column">
          <strong>Shop</strong>
          {categories.slice(1).map((item) => (
            <button key={item} type="button" onClick={() => onCategory(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="footer-column">
          <strong>Customer care</strong>
          <button type="button" onClick={() => onPolicy("shipping")}>
            Shipping & delivery
          </button>
          <button type="button" onClick={() => onPolicy("returns")}>
            Returns & replacements
          </button>
          <a href="#faq">FAQs</a>
          <a href={`https://wa.me/${settings.support.whatsapp}`}>
            Contact support
          </a>
        </div>
        <div className="footer-column">
          <strong>Legal</strong>
          <button type="button" onClick={() => onPolicy("privacy")}>
            Privacy policy
          </button>
          <button type="button" onClick={() => onPolicy("terms")}>
            Terms of sale
          </button>
          <span>GSTIN: AJPPG2208L1Z4</span>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© 2026 Kelenate · M/s North West</span>
        <div>
          <span>UPI</span>
          <span>RuPay</span>
          <span>Visa</span>
          <span>COD</span>
        </div>
      </div>
    </footer>
  );
}

function PolicyModal({ type, onClose, settings }) {
  const content = policiesFor(settings)[type];
  const Icon = content.icon;
  return (
    <div className="modal-wrap">
      <button
        className="overlay-backdrop"
        type="button"
        aria-label="Close policy"
        onClick={onClose}
      />
      <div
        className="policy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-title"
      >
        <button
          className="modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close policy"
        >
          <X size={21} />
        </button>
        <span className="policy-icon">
          <Icon size={26} />
        </span>
        <p className="eyebrow">{content.eyebrow}</p>
        <h2 id="policy-title">{content.title}</h2>
        <div className="policy-content">
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h3>{section.heading}</h3>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
        <div className="policy-support">
          <Phone size={18} />
          <p>
            <strong>Need a hand?</strong>
            Call or WhatsApp {settings.support.phone}.
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, copy }) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <p>{copy}</p>
    </div>
  );
}

export default App;
