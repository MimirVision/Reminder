// Adds the Google sign-in return address (the reversed iOS client id) as an extra URL scheme when the id is provided at build time.
module.exports = ({ config }) => {
  const gid = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const schemes = [config.scheme];
  if (gid) schemes.push('com.googleusercontent.apps.' + gid.replace('.apps.googleusercontent.com', ''));
  return { ...config, scheme: schemes };
};
