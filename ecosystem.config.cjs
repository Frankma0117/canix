module.exports = {
  apps: [
    {
      name: 'canix',
      script: 'npm',
      args: 'run start',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
