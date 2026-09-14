/**
 * Entry gate: with a (stub) user → courses; without → login. The root
 * layout only mounts the Stack after hydration, so `user` is settled here.
 */
import { Redirect } from "expo-router";

import { useAppState } from "../lib/appStore";

export default function Index() {
  const auth = useAppState((s) => s.auth);
  return <Redirect href={auth ? "/courses" : "/login"} />;
}
