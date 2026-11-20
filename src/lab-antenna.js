import { Euler, Quaternion, Vector3 } from 'three';
import { anatomy } from './sculpt.js';

export const antennaLengths = [.485, .089, .061, .059, .055, .055, .056, .060, .094, .137];

export function antennaRotation(side, input, joint) {
  if (joint === 0) return [0, -side * (.69 + input[0] * .87), .83 + input[1] * .81];
  if (joint === 1) return [0, side * (.07 + input[2] * .62), -1.29 + input[3] * 1.01];
  return [0, side * (.016 + input[joint + 2] * .17), -.043 + input[joint + 2] * .38];
}

const sockets = [-1, 1].map(side => {
  const socket = anatomy.head.surface(.710, side * 1.58);
  socket.y += .009;
  return socket;
});
const turn = new Euler();
const rotation = new Quaternion();
const cumulative = new Quaternion();
const link = new Vector3();
const neck = new Euler();
const thorax = new Euler();
const insertion = new Vector3(.585, .124, 0);
const delta = new Vector3();

export function feelers(ant) {
  const { body, x, z, heading } = ant;
  const { headRoll, headYaw, headPitch } = body.joints;
  neck.set(headRoll, headYaw, headPitch, 'YXZ');
  thorax.set(body.roll, heading, body.pitch, 'YXZ');
  const world = point => point.applyEuler(neck).add(insertion).applyEuler(thorax).add(delta.set(x, body.height, z));
  return {
    mouth: world(new Vector3(.84, -.21, 0)),
    paths: body.antennae.map((values, i) => {
      const side = i ? 1 : -1;
      const position = sockets[i].clone();
      cumulative.identity();
      const paths = [world(position.clone())];
      for (let j = 0; j < antennaLengths.length; j++) {
        cumulative.multiply(rotation.setFromEuler(turn.set(...antennaRotation(side, values, j))));
        position.add(link.set(antennaLengths[j], 0, 0).applyQuaternion(cumulative));
        paths.push(world(position.clone()));
      }
      return paths;
    }),
  };
}
