// Deshace el último cambio que hizo la revisión periódica en un test.
//
//   npm run deshacer -- "<clave>"
//
// La clave la da la auditoría, junto a cada cambio. Vuelve a poner el estudio
// que se citaba antes, tal cual estaba.

import { deshacer } from "./ia/revision.js";

const clave = process.argv[2];
if (!clave) {
  console.error("\nFalta la clave. La auditoría (npm run auditar) la enseña junto a cada cambio.\n");
  process.exit(1);
}

const hecho = await deshacer(clave);
console.log(hecho ? "\nHecho: vuelve a estar lo que había antes del cambio.\n" : "\nEse test no tiene ningún cambio que deshacer.\n");
