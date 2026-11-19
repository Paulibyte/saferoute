// pm2 start ecosystem.config.js
module.exports = {
  apps: [{ name: 'saferoute', script: 'server.js', cwd: __dirname, env: { NODE_ENV: 'production' }, max_memory_restart: '300M' }]
};
