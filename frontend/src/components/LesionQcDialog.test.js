import { findingMM, findingPlane } from "./LesionQcDialog";

// Go to on a quality note makes the note's view the active one: the plane has
// to come out in NiiVue's numbering (0 axial, 1 coronal, 2 sagittal). On 12 Nov
// "Go to axial slice 108" left the coronal view highlighted.
describe("a quality finding's location", () => {
  const at = (plane) => ({ locations: [{ kind: "slice", plane, index: 108, mm: [9, -40, 12] }] });

  test("its view, in NiiVue's numbering", () => {
    expect(findingPlane(at("axial"))).toBe(0);
    expect(findingPlane(at("coronal"))).toBe(1);
    expect(findingPlane(at("Sagittal"))).toBe(2);
  });

  test("no view when the finding names none", () => {
    expect(findingPlane({ locations: [{ kind: "point", mm: [1, 2, 3] }] })).toBeUndefined();
    expect(findingPlane(at("oblique"))).toBeUndefined();
    expect(findingPlane({})).toBeUndefined();
  });

  test("its position", () => {
    expect(findingMM(at("axial"))).toEqual([9, -40, 12]);
    expect(findingMM({ locations: [{ mm: [1, NaN, 3] }] })).toBeNull();
  });
});
