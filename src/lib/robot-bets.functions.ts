/** Server function do robô de apostas da conta demo. */
import { createServerFn } from "@tanstack/react-start";
import type { RobotPlaysSnapshot } from "./robot-bets.server";

export type { RobotPlay, RobotLeg, RobotPlaysSnapshot } from "./robot-bets.server";

export const robotPlays = createServerFn({ method: "GET" }).handler(
  async (): Promise<RobotPlaysSnapshot> => {
    try {
      const { getRobotPlays } = await import("./robot-bets.server");
      return await getRobotPlays();
    } catch (e) {
      console.warn("[robo] falha ao montar apostas:", (e as Error).message);
      return { day: "", builtAt: new Date().toISOString(), plays: [] };
    }
  },
);
