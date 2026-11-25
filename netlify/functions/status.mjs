import { json, getEnv, getRegistrationOpen, adminError } from "./_lib.mjs";

export default async function handler() {
  try {
    const env = getEnv();
    const registrationOpen = await getRegistrationOpen(env);
    return json(200, { registrationOpen });
  } catch (error) {
    return adminError(error);
  }
}
