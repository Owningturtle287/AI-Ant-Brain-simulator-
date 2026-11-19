import * as THREE from 'three';

// Stations run along the body axis and describe the dorsal and ventral
// silhouettes, the half-width in dorsal view, and the cross-section curvature.
function stationSampler(stations) {
  const tangents = stations.map((point, index) => point.slice(1).map((value, column) => {
    const before = stations[index - 1];
    const after = stations[index + 1];
    const offset = column + 1;
    if (!before) return (after[offset] - value) / (after[0] - point[0]);
    if (!after) return (value - before[offset]) / (point[0] - before[0]);
    const left = (value - before[offset]) / (point[0] - before[0]);
    const right = (after[offset] - value) / (after[0] - point[0]);
    return left * right > 0 ? 2 * left * right / (left + right) : 0;
  }));

  function at(x) {
    const last = stations.length - 1;
    if (x <= stations[0][0]) return stations[0].slice(1);
    if (x >= stations[last][0]) return stations[last].slice(1);
    const index = stations.findIndex(station => station[0] > x) - 1;
    const start = stations[index];
    const end = stations[index + 1];
    const width = end[0] - start[0];
    const t = (x - start[0]) / width;
    const t2 = t * t;
    const t3 = t2 * t;
    return tangents[index].map((slope, column) =>
      (2 * t3 - 3 * t2 + 1) * start[column + 1] + (t3 - 2 * t2 + t) * width * slope +
      (-2 * t3 + 3 * t2) * end[column + 1] + (t3 - t2) * width * tangents[index + 1][column]);
  }
  return at;
}

const ovalPower = (value, power) => Math.sign(value) * Math.abs(value) ** power;
const peak = (value, width) => Math.exp(-((value / width) ** 2));

function profile(stations, shape = (x, y, z) => [x, y, z], tone = () => 1) {
  const dimensionalStations = stations.map(([x, top, bottom, halfWidth, power = .9, offset = 0]) => [x, top, bottom, halfWidth, power, offset]);
  const section = stationSampler(dimensionalStations);
  const first = stations[0][0];
  const length = stations.at(-1)[0] - first;
  function surface(x, angle, target = new THREE.Vector3()) {
    const [top, bottom, halfWidth, power = .9, sideOffset = 0] = section(x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const center = THREE.MathUtils.lerp(bottom, top, .48);
    const y = center + (cos >= 0 ? top - center : center - bottom) * ovalPower(cos, power);
    const z = sideOffset + halfWidth * ovalPower(sin, power);
    return target.set(...shape(x, y, z, angle));
  }
  return { stations, first, length, surface, tone };
}

const head = profile([
  [-.035, .058, .048, .005, 1], [-.008, .130, -.039, .115, .88],
  [.038, .220, -.117, .193, .85], [.112, .290, -.173, .250, .84],
  [.215, .327, -.206, .291, .81], [.330, .339, -.220, .298, .79],
  [.425, .321, -.233, .289, .79], [.516, .285, -.247, .269, .78],
  [.604, .220, -.246, .244, .79], [.658, .160, -.236, .220, .79],
  [.708, .104, -.222, .189, .82], [.742, .048, -.209, .160, .85],
  [.766, .007, -.174, .119, .92], [.789, -.045, -.118, .052, .99],
  [.801, -.075, -.079, .003, 1],
], (x, y, z, angle) => {
  const side = Math.abs(z);
  const posteriorNotch = peak(x - .155, .175) * peak(z, .067) * Math.max(0, Math.cos(angle));
  const torulus = peak(x - .72, .063) * peak(side - .168, .063) * peak(y + .011, .118);
  const clypealCarina = peak(x - .748, .079) * peak(side - .064, .025) * peak(y + .091, .095);
  const lip = peak(x - .763, .025) * peak(y + .15, .061);
  const teeth = peak(z, .021) * .012 + peak(side - .097, .023) * .025;
  return [x + clypealCarina * .017 + lip * teeth, y - .041 * posteriorNotch - clypealCarina * .004,
    z * 1.052 - Math.sign(z) * .016 * torulus];
}, (x, y, z) => .92 + .16 * peak(x - .36, .35)
  - .17 * peak(x - .76, .082) * peak(y + .14, .10));

const mesosoma = profile([
  [-.663, -.018, -.028, .004], [-.628, .059, -.088, .066],
  [-.571, .106, -.113, .118], [-.521, .154, -.141, .159],
  [-.452, .194, -.162, .191], [-.367, .215, -.168, .207],
  [-.272, .200, -.176, .198], [-.195, .164, -.184, .177],
  [-.159, .158, -.183, .170], [-.106, .187, -.177, .193],
  [-.003, .208, -.167, .213], [.062, .226, -.150, .221],
  [.125, .254, -.144, .236], [.207, .292, -.155, .249],
  [.308, .307, -.154, .244], [.400, .289, -.129, .209],
  [.481, .228, -.084, .160], [.533, .161, -.056, .116],
  [.584, .105, -.049, .080], [.624, .089, -.037, .061],
  [.642, .029, .025, .003],
], (x, y, z, angle) => {
  const side = Math.abs(Math.sin(angle));
  const suture = peak(x - (.135 + Math.cos(angle) * .052), .026) * side;
  const pleuralFlange = peak(x + .03, .19) * peak(y + .064, .041) * side;
  return [x, y - suture * .013, z * (1 - suture * .063 + pleuralFlange * .073)];
}, (x, y, z) => .96 + .10 * peak(x - .285, .24) + .07 * peak(x + .4, .19)
  - .22 * peak(x - (.112 + y * .22), .027) * Math.min(1, Math.abs(z) * 5)
  - .16 * peak(x + .16, .028) * Math.min(1, Math.abs(z) * 5)
  - .16 * Math.max(0, -y) * 4);

const petiole = profile([
  [-.253, .028, -.049, .040], [-.230, .101, -.077, .059],
  [-.204, .191, -.085, .073], [-.173, .212, -.085, .079],
  [-.144, .198, -.077, .076], [-.117, .153, -.066, .065],
  [-.092, .075, -.052, .051], [-.065, .035, -.042, .042],
  [-.004, .030, -.035, .039], [.040, .006, .001, .003],
], undefined, (x, y) => .88 + .18 * peak(y - .13, .115));

const postpetiole = profile([
  [-.221, .002, -.003, .003], [-.200, .040, -.049, .049],
  [-.175, .099, -.077, .077], [-.146, .165, -.091, .110],
  [-.112, .176, -.094, .122], [-.075, .159, -.088, .119],
  [-.039, .105, -.075, .099], [-.017, .065, -.057, .068],
  [.028, .017, -.010, .016], [.034, .005, -.001, .004],
], undefined, (x, y) => .88 + .20 * peak(y - .09, .10));

const gaster = profile([
  [-.990, -.111, -.116, .004], [-.958, -.079, -.158, .049],
  [-.924, -.032, -.201, .100], [-.896, .006, -.230, .150],
  [-.874, .014, -.234, .161], [-.856, .010, -.227, .154],
  [-.830, .055, -.258, .186], [-.784, .120, -.289, .220],
  [-.758, .144, -.301, .243], [-.739, .134, -.285, .234],
  [-.711, .184, -.324, .268], [-.651, .235, -.352, .293],
  [-.615, .254, -.353, .304], [-.596, .243, -.339, .300],
  [-.563, .285, -.372, .324], [-.464, .322, -.382, .349],
  [-.346, .330, -.356, .342], [-.244, .298, -.313, .307],
  [-.139, .239, -.241, .227], [-.063, .144, -.165, .145],
  [-.022, .064, -.086, .085], [.015, .031, -.038, .042],
  [.029, .007, .001, .004],
], (x, y, z, angle) => {
  const belly = Math.max(0, -Math.cos(angle));
  const midline = peak(y + .145, .029) * Math.abs(Math.sin(angle));
  return [x - belly * .037 * peak(x + .48, .41), y + .007 * midline, z * (1 - .041 * midline)];
}, (x, y, z, angle) => {
  const seam = peak(x + .596, .021) * .23 + peak(x + .741, .016) * .27 + peak(x + .858, .013) * .24;
  const rim = peak(x + .615, .013) * .17 + peak(x + .757, .012) * .14 + peak(x + .876, .012) * .11;
  return .76 + .51 * peak(x + .10, .24) + .18 * Math.max(0, -Math.cos(angle)) - seam + rim;
});

gaster.seams = [-.596, -.739, -.856];

const mandible = profile([
  [0, .038, -.039, .040, .8, 0],
  [.040, .054, -.066, .062, .72, .008],
  [.085, .052, -.077, .080, .67, .014],
  [.125, .031, -.096, .097, .64, .001],
  [.166, .005, -.111, .099, .60, -.017],
  [.202, -.028, -.121, .099, .63, -.055],
  [.232, -.064, -.130, .095, .73, -.094],
  [.251, -.102, -.126, .029, .89, -.154],
  [.260, -.119, -.122, .003, 1, -.179],
], (x, y, z, angle) => {
  const cuttingEdge = Math.max(0, -Math.sin(angle)) ** 7;
  const tooth = [ [.118, .011, .022], [.159, .012, .026], [.198, .013, .032] ]
    .reduce((sum, [tip, width, depth]) => sum + depth * Math.max(0, 1 - Math.abs(x - tip) / width) ** .8, 0);
  return [x, y - tooth * cuttingEdge * .19, z - tooth * cuttingEdge];
}, (x, y, z, angle) => .76 + .22 * Math.max(0, Math.cos(angle)) + .15 * peak(x - .23, .075));

const ribbedLimb = (stations, arch, pigment = 1) => profile(stations, (x, y, z, angle) => {
  const bend = Math.sin(Math.PI * x) * arch;
  const longitudinalRidges = 1 + .035 * Math.cos(angle * 5 + x);
  return [x, y * longitudinalRidges + bend, z * longitudinalRidges];
}, (x, y, z, angle) => pigment * (.75 + .22 * Math.max(0, Math.cos(angle)) +
  .15 * peak(x - .79, .16) - .08 * peak(x - .94, .045)));

const coxa = ribbedLimb([
  [0, .58, -.54, .55], [.17, 1.10, -.79, .76], [.45, 1.05, -.90, .87],
  [.73, .72, -.58, .61], [.93, .52, -.41, .47], [1, .30, -.28, .31],
], .14, .79);
const trochanter = ribbedLimb([
  [0, .62, -.61, .60], [.26, .91, -.88, .85], [.66, .79, -.70, .78], [1, .53, -.40, .54],
], .035, .87);
const femur = ribbedLimb([
  [0, .36, -.32, .40], [.10, .61, -.51, .61], [.24, .88, -.75, .70, .75],
  [.44, 1.0, -.85, .77, .72], [.63, .91, -.84, .71, .73],
  [.80, .70, -.69, .60, .74], [.94, .56, -.51, .51], [1, .34, -.31, .41],
], .19);
const tibia = ribbedLimb([
  [0, .50, -.38, .48], [.10, .57, -.44, .55], [.24, .67, -.45, .61, .82],
  [.55, .66, -.50, .56, .84], [.77, .55, -.43, .51], [.94, .43, -.38, .43],
  [1, .28, -.27, .32],
], -.09, .92);
const tarsomere = ribbedLimb([
  [0, .47, -.47, .51], [.12, .70, -.64, .65], [.60, .53, -.52, .53],
  [.90, .45, -.44, .48], [1, .33, -.29, .32],
], .09, .97);
const scape = ribbedLimb([
  [0, .53, -.49, .54], [.08, .61, -.66, .63], [.21, .61, -.58, .62],
  [.46, .59, -.53, .60], [.71, .58, -.54, .55], [.91, .66, -.57, .60],
  [1, .44, -.42, .44],
], -.30);
const funiculus = ribbedLimb([
  [0, .44, -.40, .44], [.14, .63, -.57, .67], [.46, .66, -.59, .65],
  [.79, .57, -.53, .63], [1, .41, -.38, .43],
], .08, 1.04);
const club = ribbedLimb([
  [0, .43, -.38, .43], [.12, .61, -.52, .65], [.40, .83, -.73, .86],
  [.63, .89, -.80, .83], [.83, .76, -.70, .70], [1, .56, -.49, .56],
], .08, 1.08);
const clubTip = ribbedLimb([
  [0, .57, -.50, .56], [.15, .82, -.76, .80], [.36, .94, -.88, .94],
  [.60, .83, -.81, .83], [.78, .63, -.66, .63], [.91, .41, -.43, .39],
  [1, .022, -.022, .024],
], -.12, 1.15);

export const anatomy = { head, mesosoma, petiole, postpetiole, gaster, mandible, coxa, trochanter, femur, tibia, tarsomere, scape, funiculus, club, clubTip };

export function sculpt(definition, radial = 20, axial = 34) {
  const { stations, first, length, surface, tone } = definition;
  const rows = [];
  for (let index = 0; index < stations.length - 1; index++) {
    const x = stations[index][0];
    const span = stations[index + 1][0] - x;
    const divisions = Math.max(2, Math.ceil(span / length * axial));
    for (let row = 0; row < divisions; row++) rows.push(x + row * span / divisions);
  }
  rows.push(first + length);
  const position = [], color = [], uv = [], indices = [];
  const point = new THREE.Vector3();
  const stride = radial + 1;
  for (const [row, x] of rows.entries()) {
    for (let slice = 0; slice <= radial; slice++) {
      const u = slice / radial;
      const angle = u * Math.PI * 2;
      surface(x, angle, point);
      position.push(point.x, point.y, point.z);
      uv.push(u, (x - first) / length);
      const shade = tone(x, point.y, point.z, angle);
      color.push(shade, shade, shade);
      if (!row || !slice) continue;
      const current = row * stride + slice;
      indices.push(current - 1, current - stride, current, current - 1, current - stride - 1, current - stride);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const seam = new THREE.Vector3(), opposite = new THREE.Vector3();
  for (let row = 0; row < rows.length; row++) {
    const start = row * stride, end = start + radial;
    seam.fromBufferAttribute(normals, start);
    seam.add(opposite.fromBufferAttribute(normals, end)).normalize();
    normals.setXYZ(start, seam.x, seam.y, seam.z);
    normals.setXYZ(end, seam.x, seam.y, seam.z);
  }
  const seamRows = (definition.seams ?? []).map(x => {
    let nearest = 0;
    for (let row = 1; row < rows.length; row++) {
      if (Math.abs(rows[row] - x) < Math.abs(rows[nearest] - x)) nearest = row;
    }
    return nearest;
  });
  geometry.userData.profile = { rows: rows.length, radial, seamRows };
  return geometry;
}
