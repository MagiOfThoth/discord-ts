client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const gid = interaction.guild.id;
  const commandName = interaction.commandName;

  if (commandName === 'setalertchannel') {
    const channel = interaction.options.getChannel('channel');
    settings[gid] = settings[gid] || {};
    settings[gid].admin_channel_id = channel.id;
    saveSettings(settings);
    await interaction.reply({ content: `✅ Alert channel set to ${channel}`, ephemeral: true });

  } else if (commandName === 'setalertrole') {
    const role = interaction.options.getRole('role');
    settings[gid] = settings[gid] || {};
    settings[gid].role_id_to_ping = role.id;
    saveSettings(settings);
    await interaction.reply({ content: `✅ Alert role set to ${role}`, ephemeral: true });

  } else if (commandName === 'viewalertsettings') {
    const guildSettings = settings[gid];
    if (!guildSettings) return await interaction.reply({ content: `⚠️ No settings found.`, ephemeral: true });

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
