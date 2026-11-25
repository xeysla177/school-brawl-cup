import test from "node:test";
import assert from "node:assert/strict";
import { validateTeam } from "../netlify/functions/_lib.mjs";

const valid = {
  team_name: "STAR FORCE",
  captain_nick: "Alpha",
  captain_class: "8А",
  player2_nick: "Bravo",
  player2_class: "8Б",
  player3_nick: "Charlie",
  player3_class: "9А",
  reserve_nick: "",
  reserve_class: "",
  submission_token: "123e4567-e89b-42d3-a456-426614174000"
};

test("valid team with three players passes", () => {
  const result = validateTeam(valid);
  assert.equal(result.error, undefined);
  assert.equal(result.team.team_name, "STAR FORCE");
});

test("required player fields are enforced", () => {
  const result = validateTeam({ ...valid, player2_class: "" });
  assert.match(result.error, /обязательные поля/i);
});

test("reserve player needs both nickname and class", () => {
  const result = validateTeam({ ...valid, reserve_nick: "Sub" });
  assert.match(result.error, /запасного игрока/i);
});

test("submission token must be a UUID", () => {
  const result = validateTeam({ ...valid, submission_token: "not-a-token" });
  assert.match(result.error, /проверить отправку/i);
});

test("input lengths are capped server-side", () => {
  const result = validateTeam({ ...valid, team_name: "X".repeat(80) });
  assert.equal(result.team.team_name.length, 32);
});
