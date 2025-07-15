import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  Interaction,
  TextBasedChannel
} from 'discord.js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const TARGET_EMOJI = '🛎️';
const RESOLVE_EMOJI = '✅';
const SETTINGS_FILE = 'settings.json';
let flaggedMessages: Record<string, string> = {};

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
}

function saveSettings(settings: any) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

let settings = loadSettings();

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  await client.guilds.fetch();
  await registerSlashCommands();
});

client.on(Events.InteractionCreate, async (interaction: Interaction): Promise<void> => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const gid = interaction.guild.id;
  const commandName = interaction.commandName;

  if (commandName === 'setalertchannel') {
    const channel = interaction.options.getChannel('channel');
    if (!channel || !TextBasedChannel.isTextBased(channel)) return;

    settings[gid] = settings[gid] || {};
    settings[gid].admin_channel_id = channel.id;
    saveSettings(settings);

    await interaction.reply({ content: `✅ Alert channel set to ${channel}`, ephemeral: true });

  } else if (commandName === 'setalertrole') {
    const role = interaction.options.getRole('role');
    if (!role) return;

    settings[gid] = settings[gid] || {};
    settings[gid].role_id_to_ping = role.id;
    saveSettings(settings);

    await interaction.reply({ content: `✅ Alert role set to ${role}`, ephemeral: true });

  } else if (commandName === 'viewalertsettings') {
    const guildSettings = settings[gid];
    if (!guildSettings) {
      await interaction.reply({ content: `⚠️ No settings found.`, ephemeral: true });
      return;
    }

    const role = interaction.guild.roles.cache.get(guildSettings.role_id_to_ping);
    const channel = interaction.guild.channels.cache.get(guildSettings.admin_channel_id);

    const embed = new EmbedBuilder()
      .setTitle('🔧 Alert Settings')
      .addFields(
        { name: 'Admin Channel', value: channel ? `<#${channel.id}>` : '`[Deleted]`' },
        { name: 'Ping Role', value: role ? `<@&${role.id}>` : '`[Deleted]`' }
      )
      .setColor(0x00FF00);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (user.partial) await user.fetch();
    if (user.bot) return;

    const { message } = reaction;
    const guild = message.guild;
    const gid = guild?.id;
    if (!gid || !settings[gid]) return;

    const roleId = settings[gid].role_id_to_ping;
    const adminChannelId = settings[gid].admin_channel_id;
    const adminChannel = guild.channels.cache.get(adminChannelId);
    const member = await guild.members.fetch(user.id);

    console.log(`📩 Reaction detected: ${reaction.emoji.name} by ${user.tag}`);
    console.log(`🔎 Settings for guild:`, settings[gid]);

    if (reaction.emoji.name === TARGET_EMOJI) {
      if (flaggedMessages[message.id]) return;

      const msgPreview = message.content ? message.content.slice(0, 1024) : '[No content]';
      const msgLink = `https://discord.com/channels/${guild.id}/${message.channel.id}/${message.id}`;

      const embed = new EmbedBuilder()
        .setTitle('🔔 Message Flagged')
        .setDescription(`${user} reacted with ${TARGET_EMOJI} in <#${message.channel.id}>`)
        .addFields(
          { name: 'Quoted Message', value: msgPreview },
          { name: 'Jump to Message', value: `[Click here to view](${msgLink})` }
        )
        .setFooter({ text: `Message ID: ${message.id}` })
        .setColor(0xFFA500);

      console.log(`📢 Sending alert to <#${adminChannelId}> tagging <@&${roleId}>`);
      const botMsg = await (adminChannel as TextBasedChannel).send({ content: `<@&${roleId}>`, embeds: [embed] });
      await botMsg.react(RESOLVE_EMOJI);
      flaggedMessages[message.id] = botMsg.id;

      console.log(`✅ Alert message sent: ${botMsg.id}`);

    } else if (reaction.emoji.name === RESOLVE_EMOJI) {
      if (!member.roles.cache.has(roleId)) {
        console.log(`⛔ User ${user.tag} does not have the required role.`);
        return;
      }

      const alertMessageId = reaction.message.id;
      const originalId = Object.entries(flaggedMessages).find(([_, v]) => v === alertMessageId)?.[0];

      if (!originalId) {
        console.log('⚠️ No matching flagged message found.');
        return;
      }

      try {
        const originalChannel = message.channel;
        const originalMessage = await originalChannel.messages.fetch(originalId);
        await originalMessage.reactions.resolve(TARGET_EMOJI)?.remove();
        console.log(`🧹 Removed 🛎️ from flagged message: ${originalId}`);
      } catch (err) {
        console.warn('⚠️ Could not remove 🛎️ from original message');
      }

      try {
        await message.delete();
        console.log(`🗑️ Deleted alert message: ${alertMessageId}`);
      } catch (err) {
        console.warn('⚠️ Could not delete alert message');
      }

      delete flaggedMessages[originalId];
    }
  } catch (err) {
    console.error('❌ Reaction handler failed:', err);
  }
});

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('setalertchannel')
      .setDescription('Set the channel to receive 🛎 alerts')
      .addChannelOption(option =>
        option.setName('channel').setDescription('The channel to send alerts to').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('setalertrole')
      .setDescription('Set the role to ping when a message is flagged')
      .addRoleOption(option =>
        option.setName('role').setDescription('The role to mention').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('viewalertsettings')
      .setDescription('View the current alert settings')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
  try {
    const clientId = client.user!.id;
    const guilds = client.guilds.cache.map(g => g.id);
    for (const guildId of guilds) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`✅ Registered slash commands for guild ${guildId}`);
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
}

client.login(process.env.DISCORD_TOKEN!);
