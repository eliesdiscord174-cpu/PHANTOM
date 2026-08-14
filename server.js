// server.js
// Serveur Express gérant la connexion "Se connecter avec Discord" (OAuth2)
// et le stockage des données dans Supabase (au lieu de fichiers JSON locaux),
// pour que TOUT LE MONDE voie exactement les mêmes données.
//
// Flux :
//  1. GET /auth/discord          -> redirige l'utilisateur vers Discord pour autorisation
//  2. GET /auth/discord/callback -> Discord redirige ici avec ?code=..., on échange le code
//                                    contre un access_token, on récupère le profil, on crée
//                                    une session, puis on redirige vers l'accueil.
//  3. GET /api/me                -> renvoie l'utilisateur connecté (ou null)
//  4. POST /auth/logout          -> détruit la session
//
// Toutes les routes de contenu (ex: /downloads) sont protégées par le middleware requireAuth.
// Seul le/les Discord ID listés dans ADMIN_DISCORD_IDS ont accès aux routes admin.

const express = require("express");
const session = require("express-session");
const path = require("path");
require("dotenv").config();

const supabase = require("./lib/supabase");

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI, // ex: http://localhost:3000/auth/discord/callback
  SESSION_SECRET,
  ADMIN_DISCORD_IDS = "", // ex: "1534876283421462549"
  PORT = 3000,
} = process.env;

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
  console.warn(
    "⚠️  Variables d'environnement Discord manquantes. Copie .env.example vers .env et remplis-le."
  );
}

const adminIds = ADMIN_DISCORD_IDS.split(",").map((s) => s.trim()).filter(Boolean);

// ============================================================
// Accès aux données (Supabase). Toutes les fonctions ci-dessous
// remplacent les anciennes lectures/écritures de fichiers JSON.
// ============================================================

// ---- Téléchargements ----
function mapDownloadRow(row) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    category: row.category,
    downloads: row.downloads,
    url: row.url,
    size: row.size,
    description: row.description,
    banner: row.banner,
    image: row.image,
    video: row.video,
    rating: row.rating,
    reviewsCount: row.reviews_count,
    favoritesCount: row.favorites_count,
    detection: row.detection,
    updatedAt: row.updated_at,
  };
}

async function loadDownloads() {
  const { data, error } = await supabase.from("downloads").select("*").order("id", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapDownloadRow);
}

async function getDownload(id) {
  const { data, error } = await supabase.from("downloads").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapDownloadRow(data) : null;
}

// Recalcule la note moyenne et le nombre d'avis d'un téléchargement à partir
// des avis réellement stockés, puis persiste le résultat sur l'item.
async function recomputeRating(downloadId) {
  const { data: reviews, error } = await supabase
    .from("reviews")
    .select("rating")
    .eq("download_id", downloadId);
  if (error) throw error;

  const reviewsCount = reviews.length;
  const rating = reviewsCount ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviewsCount : 0;

  await supabase.from("downloads").update({ reviews_count: reviewsCount, rating }).eq("id", downloadId);
}

// ---- Membres (utilisateurs déjà connectés au moins une fois) ----
async function registerMember(discordId) {
  const { data: existing } = await supabase
    .from("members")
    .select("joined_at")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (existing) return existing.joined_at;

  const { data, error } = await supabase
    .from("members")
    .insert({ discord_id: discordId })
    .select("joined_at")
    .single();
  if (error) throw error;
  return data.joined_at;
}

async function countMembers() {
  const { count, error } = await supabase.from("members").select("*", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
}

// ---- Avis de la communauté (un avis par utilisateur et par téléchargement) ----
function mapReviewRow(row) {
  return {
    id: row.id,
    downloadId: row.download_id,
    userId: row.user_id,
    username: row.username,
    avatar: row.avatar,
    rating: row.rating,
    text: row.text,
    verified: row.verified,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---- Boutique : produits payants (comptes/clés livrés après paiement Stripe) ----
function mapProductRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    image: row.image,
    createdAt: row.created_at,
  };
}

// ---- Actualités : articles du blog, gérés depuis le panneau admin ----
function mapArticleRow(row) {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    image: row.image,
    author: row.author,
    createdAt: row.created_at,
  };
}

// ---- Réglages du site : textes modifiables depuis le panneau admin (ex: hero de l'accueil) ----
const DEFAULT_SETTINGS = {
  heroBadge: "Plateforme officielle PHANTOM",
  heroTitleLine1: "Téléchargez vos outils",
  heroTitleLine2: "sur n'importe quel jeu",
  heroLead:
    "Overlays, thèmes, extensions et utilitaires pour vos jeux préférés, gratuitement et en un clic. Connectez-vous avec Discord et téléchargez immédiatement.",
};

async function loadSettings() {
  const { data, error } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_SETTINGS };
  return {
    heroBadge: data.hero_badge ?? DEFAULT_SETTINGS.heroBadge,
    heroTitleLine1: data.hero_title_line1 ?? DEFAULT_SETTINGS.heroTitleLine1,
    heroTitleLine2: data.hero_title_line2 ?? DEFAULT_SETTINGS.heroTitleLine2,
    heroLead: data.hero_lead ?? DEFAULT_SETTINGS.heroLead,
  };
}

async function saveSettings(patch) {
  const current = await loadSettings();
  const updated = { ...current, ...patch };
  const { error } = await supabase.from("settings").upsert({
    id: 1,
    hero_badge: updated.heroBadge,
    hero_title_line1: updated.heroTitleLine1,
    hero_title_line2: updated.heroTitleLine2,
    hero_lead: updated.heroLead,
  });
  if (error) throw error;
  return updated;
}

// ---- Notification Discord : annonce automatique dans un salon quand un ----
// ---- nouveau téléchargement est ajouté depuis /admin. Optionnel : si     ----
// ---- DISCORD_WEBHOOK_URL n'est pas défini, cette fonction ne fait rien.  ----
const { DISCORD_WEBHOOK_URL } = process.env;

async function notifyDiscordNewDownload(item) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("ℹ️  DISCORD_WEBHOOK_URL non défini, notification ignorée.");
    return;
  }

  console.log(`📤 Envoi de la notification Discord pour "${item.name}"...`);

  // Discord est strict sur les embeds : titre <= 256 caractères, description
  // <= 4096, et chaque field.value doit être une chaîne NON VIDE.
  const safeTitle = String(`🆕 ${item.name || "Nouveau téléchargement"}`).slice(0, 256);
  const safeDescription = item.description ? String(item.description).slice(0, 4096) : undefined;
  const safeField = (v) => {
    const s = v == null ? "" : String(v).trim();
    return s.length ? s.slice(0, 1024) : "—";
  };

  const payload = {
    embeds: [
      {
        title: safeTitle,
        description: safeDescription,
        color: 0xa855f7, // violet PHANTOM
        fields: [
          { name: "Version", value: safeField(item.version), inline: true },
          { name: "Catégorie", value: safeField(item.category), inline: true },
          { name: "Taille", value: safeField(item.size), inline: true },
        ],
        image: item.image ? { url: item.image } : undefined,
        timestamp: new Date().toISOString(),
        footer: { text: "PHANTOM — Nouveau téléchargement disponible" },
      },
    ],
  };

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(pas de corps de réponse)");
      console.error(`❌ Discord a refusé la notification (status ${res.status}).`);
      console.error("Corps envoyé:", JSON.stringify(payload));
      console.error("Réponse Discord:", text);
    } else {
      console.log("✅ Notification Discord envoyée avec succès.");
    }
  } catch (err) {
    // Une erreur d'envoi Discord ne doit jamais faire échouer l'ajout du
    // téléchargement lui-même : on log juste l'erreur.
    console.error("❌ Erreur réseau lors de l'envoi de la notification Discord:", err);
  }
}

const app = express();

// Render/Railway (et la plupart des hébergeurs) placent le site derrière un
// proxy HTTPS : sans ça, Express croit que la connexion est en HTTP simple
// et refuse de poser des cookies "secure".
const isProduction = process.env.NODE_ENV === "production";
if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET || "change-moi-en-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction, // cookies "secure" uniquement en production (HTTPS)
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
    },
  })
);

// ---- 1. Démarre le flux OAuth2 : redirige vers Discord ----
app.get("/auth/discord", (req, res) => {
  // Mémorise la page que l'utilisateur voulait visiter pour l'y renvoyer après le login.
  // Priorité à ?next=... (passé explicitement), sinon au Referer (page depuis laquelle
  // le clic "Se connecter" a été fait).
  const next = req.query.next || req.get("referer");
  if (next) {
    try {
      // On ne garde que le chemin (path + query), jamais une URL absolue externe,
      // pour éviter les redirections vers un autre domaine (open redirect).
      const url = new URL(next, `${req.protocol}://${req.get("host")}`);
      if (url.host === req.get("host")) {
        req.session.returnTo = url.pathname + url.search;
      }
    } catch {
      // next invalide : on ignore, la valeur par défaut restera "/"
    }
  }

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify email",
    prompt: "consent",
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

// ---- 2. Callback : Discord renvoie ici avec ?code=... ----
app.get("/auth/discord/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    // L'utilisateur a cliqué "Annuler" sur Discord
    return res.redirect("/?auth_error=access_denied");
  }
  if (!code) {
    return res.status(400).send("Code manquant.");
  }

  try {
    // Échange le code contre un access_token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error("Erreur échange token Discord:", text);
      return res.redirect("/?auth_error=token_exchange_failed");
    }

    const tokenData = await tokenRes.json(); // { access_token, token_type, ... }

    // Récupère le profil de l'utilisateur
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      return res.redirect("/?auth_error=profile_fetch_failed");
    }

    const discordUser = await userRes.json();
    // discordUser: { id, username, discriminator, avatar, email, ... }

    // Crée la session (on ne stocke JAMAIS le token côté client)
    const joinedAt = await registerMember(discordUser.id);

    req.session.user = {
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : null,
      email: discordUser.email || null,
      isAdmin: adminIds.includes(discordUser.id),
      joinedAt,
    };

    // Redirige vers la page que l'utilisateur voulait visiter avant d'être
    // envoyé se connecter (mémorisée dans /auth/discord), sinon vers l'accueil.
    const returnTo = req.session.returnTo || "/";
    delete req.session.returnTo;
    const separator = returnTo.includes("?") ? "&" : "?";
    res.redirect(`${returnTo}${separator}welcome=1`);
  } catch (err) {
    console.error(err);
    res.redirect("/?auth_error=unexpected");
  }
});

// ---- Utilisateur courant (utilisé par le frontend pour savoir s'il est connecté) ----
app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// ---- Statistiques publiques (calculées en direct à partir de Supabase) ----
app.get("/api/stats", async (req, res, next) => {
  try {
    const downloads = await loadDownloads();
    const totalDownloads = downloads.reduce((sum, d) => sum + (d.downloads || 0), 0);
    const resourcesCount = downloads.length;
    const memberCount = await countMembers();
    const totalReviews = downloads.reduce((sum, d) => sum + (d.reviewsCount || 0), 0);
    const avgRating = totalReviews
      ? downloads.reduce((sum, d) => sum + (d.rating || 0) * (d.reviewsCount || 0), 0) / totalReviews
      : 0;

    res.json({
      totalDownloads,
      resourcesCount,
      memberCount,
      avgRating: Math.round(avgRating * 10) / 10,
      totalReviews,
    });
  } catch (err) {
    next(err);
  }
});

// ---- 4. Déconnexion ----
app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ---- Middleware : protège les routes qui nécessitent d'être connecté ----
function requireAuth(req, res, next) {
  if (!req.session.user) {
    // On passe la page demandée (ex: /downloads/5) en "next" pour y revenir après le login.
    return res.redirect(`/auth/discord?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

// ---- Middleware : protège les routes réservées aux administrateurs ----
function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect(`/auth/discord?next=${encodeURIComponent(req.originalUrl)}`);
  }
  if (!req.session.user.isAdmin) {
    return res.status(403).send("Accès refusé : réservé aux administrateurs.");
  }
  next();
}

// ---- API : réglages du site (textes du hero de l'accueil), visibles par tout le monde ----
app.get("/api/settings", async (req, res, next) => {
  try {
    res.json(await loadSettings());
  } catch (err) {
    next(err);
  }
});

// ---- API : modifier les réglages du site (admin uniquement) ----
app.post("/api/settings", requireAdmin, async (req, res, next) => {
  try {
    const { heroBadge, heroTitleLine1, heroTitleLine2, heroLead } = req.body;
    const patch = {
      ...(heroBadge !== undefined ? { heroBadge } : {}),
      ...(heroTitleLine1 !== undefined ? { heroTitleLine1 } : {}),
      ...(heroTitleLine2 !== undefined ? { heroTitleLine2 } : {}),
      ...(heroLead !== undefined ? { heroLead } : {}),
    };
    const updated = await saveSettings(patch);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ---- API : top 3 les plus téléchargés (tout temps) + top 3 en tendance (7 derniers jours) ----
// Calculés en direct à partir des vraies données stockées dans Supabase.
app.get("/api/downloads/top", async (req, res, next) => {
  try {
    const list = await loadDownloads();

    const popular = [...list].sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, 3);

    const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentHistory, error } = await supabase
      .from("history")
      .select("download_id")
      .gte("timestamp", weekAgoIso);
    if (error) throw error;

    const weekCounts = {};
    (recentHistory || []).forEach((h) => {
      weekCounts[h.download_id] = (weekCounts[h.download_id] || 0) + 1;
    });

    const trending = list
      .map((d) => ({ ...d, weekDownloads: weekCounts[d.id] || 0 }))
      .sort((a, b) => b.weekDownloads - a.weekDownloads || (b.downloads || 0) - (a.downloads || 0))
      .slice(0, 3);

    res.json({ popular, trending });
  } catch (err) {
    next(err);
  }
});

// ---- API : liste des produits de la boutique (visible par tout le monde) ----
app.get("/api/products", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("products").select("*").order("id", { ascending: false });
    if (error) throw error;
    res.json({ products: (data || []).map(mapProductRow) });
  } catch (err) {
    next(err);
  }
});

// ---- API : ajouter un produit à la boutique (admin uniquement) ----
app.post("/api/products", requireAdmin, async (req, res, next) => {
  try {
    const { name, description, price, image } = req.body;
    if (!name || !price) {
      return res.status(400).json({ error: "name et price sont requis." });
    }

    const row = {
      id: Date.now(),
      name: String(name).slice(0, 100),
      description: description ? String(description).slice(0, 500) : "",
      price: String(price).slice(0, 30),
      image: image ? String(image).slice(0, 500) : "",
    };

    const { data, error } = await supabase.from("products").insert(row).select("*").single();
    if (error) throw error;

    res.status(201).json({ product: mapProductRow(data) });
  } catch (err) {
    next(err);
  }
});

// ---- API : supprimer un produit de la boutique (admin uniquement) ----
app.delete("/api/products/:id", requireAdmin, async (req, res, next) => {
  try {
    const { error } = await supabase.from("products").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- API : liste des articles du blog (visible par tout le monde) ----
app.get("/api/articles", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("articles").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ articles: (data || []).map(mapArticleRow) });
  } catch (err) {
    next(err);
  }
});

// ---- API : publier un article (admin uniquement) ----
app.post("/api/articles", requireAdmin, async (req, res, next) => {
  try {
    const { title, excerpt, content, image, author } = req.body;
    if (!title || !excerpt) {
      return res.status(400).json({ error: "Le titre et le résumé sont requis." });
    }

    const row = {
      id: Date.now(),
      title: String(title).slice(0, 140),
      excerpt: String(excerpt).slice(0, 300),
      content: content ? String(content).slice(0, 10000) : "",
      image: image ? String(image).slice(0, 500) : "",
      author: author ? String(author).slice(0, 80) : "Équipe PHANTOM",
    };

    const { data, error } = await supabase.from("articles").insert(row).select("*").single();
    if (error) throw error;

    res.status(201).json({ article: mapArticleRow(data) });
  } catch (err) {
    next(err);
  }
});

// ---- API : supprimer un article (admin uniquement) ----
app.delete("/api/articles/:id", requireAdmin, async (req, res, next) => {
  try {
    const { error } = await supabase.from("articles").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- API : liste des téléchargements (visible par tout le monde) ----
app.get("/api/downloads", async (req, res, next) => {
  try {
    res.json({ downloads: await loadDownloads() });
  } catch (err) {
    next(err);
  }
});

// ---- API : détail d'un téléchargement (visible par tout le monde) ----
app.get("/api/downloads/:id", async (req, res, next) => {
  try {
    const item = await getDownload(req.params.id);
    if (!item) return res.status(404).json({ error: "Introuvable." });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// ---- API : ajouter un téléchargement (admin uniquement) ----
app.post("/api/downloads", requireAdmin, async (req, res, next) => {
  try {
    const { name, version, category, url, size, description, banner, image, video } = req.body;
    if (!name || !version || !category) {
      return res.status(400).json({ error: "name, version et category sont requis." });
    }

    const row = {
      id: Date.now(),
      name: String(name).slice(0, 100),
      version: String(version).slice(0, 30),
      category: String(category).slice(0, 40),
      url: url ? String(url).slice(0, 300) : "#",
      size: size ? String(size).slice(0, 30) : "",
      description: description ? String(description).slice(0, 2000) : "",
      banner: banner ? String(banner).slice(0, 500) : "",
      image: image ? String(image).slice(0, 500) : "",
      video: video ? String(video).slice(0, 500) : "",
      downloads: 0,
      rating: 0,
      reviews_count: 0,
      favorites_count: 0,
      detection: "undetectable",
    };

    const { data, error } = await supabase.from("downloads").insert(row).select("*").single();
    if (error) throw error;

    const newItem = mapDownloadRow(data);
    notifyDiscordNewDownload(newItem); // envoi en arrière-plan, ne bloque pas la réponse

    res.status(201).json({ item: newItem });
  } catch (err) {
    next(err);
  }
});

// ---- API : supprimer un téléchargement (admin uniquement) ----
app.delete("/api/downloads/:id", requireAdmin, async (req, res, next) => {
  try {
    const { error } = await supabase.from("downloads").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- API : modifier le statut de détection d'un téléchargement (admin uniquement) ----
const VALID_DETECTION_STATUSES = ["detectable", "semi", "undetectable"];
app.patch("/api/downloads/:id/detection", requireAdmin, async (req, res, next) => {
  try {
    const { detection } = req.body;
    if (!VALID_DETECTION_STATUSES.includes(detection)) {
      return res.status(400).json({ error: "Statut invalide." });
    }

    const { data, error } = await supabase
      .from("downloads")
      .update({ detection })
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Introuvable." });

    res.json({ item: mapDownloadRow(data) });
  } catch (err) {
    next(err);
  }
});

// ---- API : enregistre un téléchargement effectué par l'utilisateur connecté ----
app.post("/api/downloads/:id/click", requireAuth, async (req, res, next) => {
  try {
    const item = await getDownload(req.params.id);
    if (!item) return res.status(404).json({ error: "Introuvable." });

    const { error: updateError } = await supabase
      .from("downloads")
      .update({ downloads: (item.downloads || 0) + 1 })
      .eq("id", item.id);
    if (updateError) throw updateError;

    const { error: historyError } = await supabase.from("history").insert({
      id: Date.now(),
      user_id: req.session.user.id,
      download_id: item.id,
      name: item.name,
    });
    if (historyError) throw historyError;

    res.json({ ok: true, url: item.url });
  } catch (err) {
    next(err);
  }
});

// ---- API : profil complet de l'utilisateur connecté (stats + historique) ----
app.get("/api/profile", requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.id;

    const { data: historyRows, error: historyError } = await supabase
      .from("history")
      .select("*")
      .eq("user_id", userId)
      .order("timestamp", { ascending: false })
      .limit(25);
    if (historyError) throw historyError;

    const { count: myReviewsCount, error: reviewsError } = await supabase
      .from("reviews")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (reviewsError) throw reviewsError;

    const { count: downloadsCount, error: countError } = await supabase
      .from("history")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) throw countError;

    res.json({
      user: req.session.user,
      stats: {
        downloadsCount: downloadsCount || 0,
        reviewsCount: myReviewsCount || 0,
        favoritesCount: 0,
      },
      history: (historyRows || []).map((h) => ({
        id: h.id,
        userId: h.user_id,
        downloadId: h.download_id,
        name: h.name,
        timestamp: h.timestamp,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---- API : avis d'un téléchargement (liste + répartition par note, visible par tout le monde) ----
app.get("/api/downloads/:id/reviews", async (req, res, next) => {
  try {
    const downloadId = req.params.id;
    const { data: rows, error } = await supabase
      .from("reviews")
      .select("*")
      .eq("download_id", downloadId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const reviews = (rows || []).map(mapReviewRow);

    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach((r) => {
      breakdown[r.rating] = (breakdown[r.rating] || 0) + 1;
    });

    // myReview n'a de sens que si l'utilisateur est connecté.
    const myReview = req.session.user
      ? reviews.find((r) => r.userId === req.session.user.id) || null
      : null;

    res.json({ reviews, breakdown, myReview });
  } catch (err) {
    next(err);
  }
});

// ---- API : poster (ou mettre à jour) son avis sur un téléchargement ----
app.post("/api/downloads/:id/reviews", requireAuth, async (req, res, next) => {
  try {
    const downloadId = req.params.id;
    const item = await getDownload(downloadId);
    if (!item) return res.status(404).json({ error: "Introuvable." });

    const rating = Math.round(Number(req.body.rating));
    const text = String(req.body.text || "").slice(0, 1000).trim();

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "La note doit être comprise entre 1 et 5." });
    }

    const user = req.session.user;

    const { count: downloadedCount, error: historyError } = await supabase
      .from("history")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("download_id", downloadId);
    if (historyError) throw historyError;
    const hasDownloaded = (downloadedCount || 0) > 0;

    const { data: existing, error: existingError } = await supabase
      .from("reviews")
      .select("id")
      .eq("user_id", user.id)
      .eq("download_id", downloadId)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      const { error } = await supabase
        .from("reviews")
        .update({
          rating,
          text,
          verified: hasDownloaded,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("reviews").insert({
        id: Date.now(),
        download_id: item.id,
        user_id: user.id,
        username: user.username,
        avatar: user.avatar,
        rating,
        text,
        verified: hasDownloaded,
      });
      if (error) throw error;
    }

    await recomputeRating(item.id);

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Liste des téléchargements : consultable sans connexion.
// Seul le clic sur "Télécharger" (POST /api/downloads/:id/click) exige d'être connecté.
app.get("/downloads", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "downloads.html"));
});

// Page boutique : consultable sans connexion.
app.get("/boutique", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "boutique.html"));
});

// Page actualités : consultable sans connexion.
app.get("/actualites", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "actualites.html"));
});

// Fiche détaillée d'un téléchargement : consultable sans connexion.
app.get("/downloads/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "download.html"));
});

// Page de profil de l'utilisateur connecté
app.get("/profile", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"));
});

// Page d'administration (ajout de téléchargements)
app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Gestionnaire d'erreurs générique pour les routes async ci-dessus
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur serveur." });
});

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
