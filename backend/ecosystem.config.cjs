module.exports = {
  apps: [
    {
      name: 'beatflow-backend',
      script: 'index.js',
      cwd: '/root/beatflow-native/backend',
      env: {
        YT_COOKIES: '/root/beatflow-native/backend/yt-cookies-netscape.txt',
        YTDLP_PROXY: 'socks5://127.0.0.1:1080',
      },
    },
  ],
};
