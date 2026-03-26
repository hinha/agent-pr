module.exports = {
  apps: [{
    name: 'pr-monitor-daemon',
    script: 'index.js',
    instances: 1,  // Single instance - daemon with shared state management
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    autorestart: true,
    // Graceful shutdown settings to prevent 409 conflicts
    kill_timeout: 5000,      // Wait 5 seconds before force kill
    wait_ready: true,        // Wait for app to be ready
    listen_timeout: 10000    // Timeout for app to listen
  }]
};
