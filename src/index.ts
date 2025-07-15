import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  TextChannel,
  Interaction,
  Role,
  Channel,
  MessageReaction
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) throw new Error('❌ DISCORD_TOKEN not set in environment variables.');

const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');
const TARGET_EMOJI = '🛎';
const RESOLVE_EMOJI = '✅';

interface GuildSettings {
  admin_channel_id?: string;
  role_id_to_ping?: string;
}
const flaggedMessages: Record<string, string> = {};
const settings: Record<string, GuildSettings> = loadSettings();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

function loadSettings(): Record<string, GuildSettings> {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  await registerSlashCommands();
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const gid = interaction.guild.id;
  const command = interaction.commandName;

  if (command === 'setalertchannel') {
    const channel = interaction.options.getChannel('channel') as Channel;
    if (!channel || channel.type !== 0) return interaction.reply({ content: '❌ Must be a text channel.', ephemeral: true });

    settings[gid] = settings[gid] || {};
    settings[gid].admin_channel_id = channel.id;
    saveSettings();

    await interaction.reply({ content: `✅ Alert channel set to ${channel}`, ephemeral: true });
  }

  if (command === 'setalertrole') {
    const role = interaction.options.getRole('role') as Role;
    if (!role) return interaction.reply({ content: '❌ Role not found.', ephemeral: true });

    settings[gid] = settings[gid] || {};
    settings[gid].role_id_to_ping = role.id;
    saveSettings();

    await interaction.reply({ content: `✅ Alert role set to ${role}`, ephemeral: true });
  }

  if (command === 'viewalertsettings') {
    const s = settings[gid];
    if (!s) return interaction.reply({ content: `⚠️ No alert settings found.`, ephemeral: true });

    const role = interaction.guild.roles.cache.get(s.role_id_to_ping!);
    const channel = interaction.guild.channels.cache.get(s.admin_channel_id!);

    const embed = new EmbedBuilder()
      .setTitle('🔧 Alert Settings')
      .addFields(
        { name: 'Admin Channel', value: channel ? `<#${channel.id}>` : '`[Deleted]`' },
        { name: 'Ping Role', value: role ? `<@&${role.id}>` : '`[Deleted]`' }
      )
      .setColor(0x00ff00);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.on(Events.MessageReactionAdd, async (reaction: MessageReaction, user) => {
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    if (user.bot) return;

    const { message } = reaction;
    const guild = message.guild;
    if (!guild) return;

    const gid = guild.id;
    const s = settings[gid];
    if (!s) return;

    const adminChannel = guild.channels.cache.get(s.admin_channel_id!) as TextChannel;
    const role = guild.roles.cache.get(s.role_id_to_ping!);
    if (!adminChannel || !role) return;

    if (reaction.emoji.name === TARGET_EMOJI) {
      if (flaggedMessages[message.id]) return;

      const preview = message.content?.slice(0, 1024) || '[No content]';
      const msgLink = `https://discord.com/channels/${guild.id}/${message.channel.id}/${message.id}`;

      const embed = new EmbedBuilder()
        .setTitle('🔔 Message Flagged')
        .setDescription(`${user} reacted with 🛎 in <#${message.channel.id}>`)
        .addFields(
          { name: 'Quoted Message', value: preview },
          { name: 'Jump to Message', value: `[Click to view](${msgLink})` }
        )
        .setColor(0xffa500);

      const sent = await adminChannel.send({ content: `<@&${role.id}>`, embeds: [embed] });
      await sent.react(RESOLVE_EMOJI);

      flaggedMessages[message.id] = sent.id;
    }

    if (reaction.emoji.name === RESOLVE_EMOJI) {
      const member = await guild.members.fetch(user.id);
      if (!member.roles.cache.has(role.id)) return;

      const originalMsgId = Object.keys(flaggedMessages).find(
        key => flaggedMessages[key] === reaction.message.id
      );
      if (!originalMsgId) return;

      try {
        const msg = await reaction.message.channel.messages.fetch(originalMsgId);
        await msg.reactions.resolve(TARGET_EMOJI)?.remove();
      } catch {}

      try {
        await reaction.message.delete();
      } catch {}

      delete flaggedMessages[originalMsgId];
    }
  } catch (e) {
    console.error('❌ Reaction handler error:', e);
  }
});

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('setalertchannel')
      .setDescription('Set the channel to receive alerts')
      .addChannelOption(option =>
        option.setName('channel').setDescription('Channel to send alerts to').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setalertrole')
      .setDescription('Set the role to ping on alerts')
      .addRoleOption(option =>
        option.setName('role').setDescription('Role to ping').setRequired(true)),

    new SlashCommandBuilder()
      .setName('viewalertsettings')
      .setDescription('View current alert settings')
  ];

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const clientId = (await client.application?.fetch())?.id;
  const guildIds = client.guilds.cache.map(g => g.id);

  for (const gid of guildIds) {
    await rest.put(Routes.applicationGuildCommands(clientId!, gid), {
      body: commands.map(cmd => cmd.toJSON())
    });
    console.log(`✅ Slash commands registered for guild: ${gid}`);
  }
}

client.login(DISCORD_TOKEN);
