// lib/supabase.js
// Client Supabase utilisé UNIQUEMENT côté serveur (jamais envoyé au navigateur).
// Il utilise la clé "service_role", qui a tous les droits sur la base : c'est
// ce qui permet à tout le monde de voir les mêmes données (stockées une fois,
// dans une seule base, au lieu de fichiers JSON locaux différents par machine).

const { createClient } = require("@supabase/supabase-js");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "⚠️  SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant. Copie .env.example vers .env et remplis-le."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

module.exports = supabase;
