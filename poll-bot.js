// poll-bot.js
// Bot Discord (discord.js) qui poste un sondage à boutons pour chaque nouvel outil
// et compte les votes en temps réel (👍 Cool / 🤷 Mitigé / 👎 Pas cool).
//
// IMPORTANT : contrairement à un webhook simple, un vrai bot (token bot) est
// obligatoire ici car Discord ne permet pas à un webhook de recevoir les clics
// sur des boutons — seul un bot connecté en permanence (Gateway) peut le faire.
//
// Le salon où poster le sondage est déterminé automatiquement à partir de
// l'URL de webhook DISCORD_POLL_WEBHOOK_URL (on la lit juste pour récupérer
// le channel_id, le message lui-même est envoyé par le bot, pas par le webhook,
// sinon les boutons ne seraient pas cliquables).
//
// Utilisation dans server.js :
//   const { startPollBot, postToolPoll } = require("./poll-bot");
//   startPollBot(); // à appeler une fois au démarrage du serveur
//   // puis, après avoir ajouté un outil (POST /api/downloads) :
//   await postToolPoll(newItem);

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
require("dotenv").config();

const supabase = require("./lib/supabase");

const { DISCORD_BOT_TOKEN, DISCORD_POLL_WEBHOOK_URL } = process.env;

if (!DISCORD_BOT_TOKEN) {
  console.warn("⚠️  DISCORD_BOT_TOKEN manquant : le bot de sondage ne démarrera pas.");
}
if (!DISCORD_POLL_WEBHOOK_URL) {
  console.warn("⚠️  DISCORD_POLL_WEBHOOK_URL manquant : impossible de savoir où poster le sondage.");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let pollChannelId = null;

// Récupère le channel_id associé au webhook (le webhook lui-même n'est pas
// utilisé pour envoyer le message, juste pour retrouver le bon salon).
async function resolvePollChannelId() {
  if (pollChannelId) return pollChannelId;
  const res = await fetch(DISCORD_POLL_WEBHOOK_URL);
  if (!res.ok) throw new Error("Impossible de résoudre le salon du webhook de sondage.");
  const data = await res.json();
  pollChannelId = data.channel_id;
  return pollChannelId;
}

function buildPollComponents(pollId, counts = { cool: 0, meh: 0, bad: 0 }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poll:${pollId}:cool`)
      .setLabel(`👍 Cool (${counts.cool})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`poll:${pollId}:meh`)
      .setLabel(`🤷 Mitigé (${counts.meh})`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`poll:${pollId}:bad`)
      .setLabel(`👎 Pas cool (${counts.bad})`)
      .setStyle(ButtonStyle.Danger)
  );
  return [row];
}

// Poste le sondage pour un nouvel outil. À appeler juste après avoir ajouté
// l'outil dans Supabase (ex: dans la route POST /api/downloads de server.js).
async function postToolPoll(item) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_POLL_WEBHOOK_URL) return;

  const channelId = await resolvePollChannelId();
  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new Error("Salon de sondage introuvable.");

  // 1) On crée d'abord la ligne en base pour obtenir un id de sondage
  const { data: poll, error } = await supabase
    .from("tool_polls")
    .insert({ download_id: item.id })
    .select("id")
    .single();
  if (error) throw error;

  // 2) On envoie le message avec les boutons (compteurs à 0)
  const message = await channel.send({
    content: `📊 **${item.name}** — il est cool ou pas ce nouvel outil ?`,
    components: buildPollComponents(poll.id),
  });

  // 3) On enregistre l'id du message pour pouvoir l'éditer plus tard
  await supabase.from("tool_polls").update({ message_id: message.id }).eq("id", poll.id);
}

// Recalcule les votes d'un sondage et retourne les compteurs.
async function getPollCounts(pollId) {
  const { data: votes, error } = await supabase
    .from("poll_votes")
    .select("vote")
    .eq("poll_id", pollId);
  if (error) throw error;

  const counts = { cool: 0, meh: 0, bad: 0 };
  (votes || []).forEach((v) => {
    if (counts[v.vote] !== undefined) counts[v.vote]++;
  });
  return counts;
}

// Gère les clics sur les boutons.
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const [prefix, pollId, vote] = interaction.customId.split(":");
  if (prefix !== "poll") return;

  try {
    // Un seul vote par utilisateur et par sondage : upsert.
    const { error } = await supabase
      .from("poll_votes")
      .upsert(
        { poll_id: pollId, user_id: interaction.user.id, vote },
        { onConflict: "poll_id,user_id" }
      );
    if (error) throw error;

    const counts = await getPollCounts(pollId);

    await interaction.update({
      components: buildPollComponents(pollId, counts),
    });
  } catch (err) {
    console.error("Erreur lors du vote de sondage :", err);
    if (!interaction.replied) {
      await interaction.reply({ content: "❌ Erreur lors de l'enregistrement du vote.", ephemeral: true }).catch(() => {});
    }
  }
});

client.once("ready", () => {
  console.log(`✅ Bot de sondage connecté en tant que ${client.user.tag}`);
});

function startPollBot() {
  if (!DISCORD_BOT_TOKEN) return;
  client.login(DISCORD_BOT_TOKEN);
}

module.exports = { startPollBot, postToolPoll };
