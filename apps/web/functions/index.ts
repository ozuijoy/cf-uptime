export const onRequest: PagesFunction = async ({ next }) => {
  // Keep behavior identical to static Pages by default.
  return next();
};
