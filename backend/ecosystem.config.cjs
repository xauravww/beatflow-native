module.exports = {
  apps: [
    {
      name: 'beatflow-backend',
      script: 'index.js',
      cwd: '/root/beatflow-native/backend',
      env: {
        YT_COOKIES: '/root/beatflow-native/backend/yt-cookies-netscape.txt',
      },
    },
  ],
};
