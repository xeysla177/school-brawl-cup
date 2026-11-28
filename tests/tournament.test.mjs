import test from "node:test";
import assert from "node:assert/strict";
import { buildBracket, getPlacements, RANKED_MAPS } from "../netlify/functions/_tournament.mjs";

function teams(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `team-${i + 1}` }));
}

test("Ranked catalog contains six modes and 24 maps", () => {
  assert.equal(Object.keys(RANKED_MAPS).length, 6);
  assert.equal(Object.values(RANKED_MAPS).flat().length, 24);
});

for (const count of [2, 3, 5, 6, 7, 8, 9, 13, 16]) {
  test(`bracket correctly places ${count} teams`, () => {
    const entries = teams(count);
    const matches = buildBracket("tournament-1", entries);
    const size = 2 ** Math.ceil(Math.log2(count));
    const firstRound = matches.filter(match => match.round_number === 1);
    const assigned = firstRound.flatMap(match => [match.team1_id, match.team2_id]).filter(Boolean);
    const bronzeCount = count >= 4 ? 1 : 0;

    assert.equal(matches.length, size - 1 + bronzeCount);
    assert.equal(firstRound.filter(match => match.status === "bye").length, size - count);
    assert.deepEqual(new Set(assigned), new Set(entries.map(team => team.id)));
    assert.equal(assigned.length, count);

    const finalRound = Math.log2(size);
    const bronze = matches.find(match => match.round_number === finalRound && match.match_number === 2);
    assert.equal(Boolean(bronze), count >= 4);
    if (bronze) {
      assert.equal(bronze.status, "pending");
      assert.equal(bronze.team1_id, null);
      assert.equal(bronze.team2_id, null);
      assert.equal(bronze.next_match_id, null);
    }

    for (const match of matches.filter(item => item.next_match_id)) {
      const target = matches.find(item => item.id === match.next_match_id);
      assert.ok(target);
      assert.ok([1, 2].includes(match.next_slot));
    }
  });
}

test("podium derives champion, runner-up and bronze-match winner", () => {
  const matches = [
    { round_number: 1, match_number: 1, status: "completed", team1_id: "a", team2_id: "b", winner_team_id: "a" },
    { round_number: 1, match_number: 2, status: "completed", team1_id: "c", team2_id: "d", winner_team_id: "d" },
    { round_number: 2, match_number: 1, status: "completed", team1_id: "a", team2_id: "d", winner_team_id: "d" },
    { round_number: 2, match_number: 2, status: "completed", team1_id: "b", team2_id: "c", winner_team_id: "c" }
  ];
  assert.deepEqual(getPlacements(matches), { first: "d", second: "a", third: ["c"] });
});

test("legacy archives keep shared third place", () => {
  const matches = [
    { round_number: 1, match_number: 1, status: "completed", team1_id: "a", team2_id: "b", winner_team_id: "a" },
    { round_number: 1, match_number: 2, status: "completed", team1_id: "c", team2_id: "d", winner_team_id: "d" },
    { round_number: 2, match_number: 1, status: "completed", team1_id: "a", team2_id: "d", winner_team_id: "d" }
  ];
  assert.deepEqual(getPlacements(matches), { first: "d", second: "a", third: ["b", "c"] });
});

test("three-team bracket records one third-place finisher without bronze match", () => {
  const matches = [
    { round_number: 1, match_number: 1, status: "bye", team1_id: "a", team2_id: null, winner_team_id: "a" },
    { round_number: 1, match_number: 2, status: "completed", team1_id: "b", team2_id: "c", winner_team_id: "b" },
    { round_number: 2, match_number: 1, status: "completed", team1_id: "a", team2_id: "b", winner_team_id: "a" }
  ];
  assert.deepEqual(getPlacements(matches), { first: "a", second: "b", third: ["c"] });
});
