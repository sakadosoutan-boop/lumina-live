import { expect, it } from "vitest";
import { spatialUniforms } from "../src/spatial-fx";
const fx = { glitch: 0, bloom: 0, vignette: 0, chromatic: 0, pixelate: 0 };
it("bounds malformed runtime values and keeps negative/long transport clocks periodic", () => {
  expect(
    spatialUniforms(
      { ...fx, depth: Infinity, mapping: NaN, motionBeats: 0 },
      NaN,
    ),
  ).toEqual([0, 0, 0, 0]);
  expect(spatialUniforms({ ...fx, depth: -2, mapping: 2 }, -2)).toEqual([
    -1, 1, 0.75, 0,
  ]);
  expect(spatialUniforms(fx, 8 * 1000000 + 2)[2]).toBe(0.25);
});
