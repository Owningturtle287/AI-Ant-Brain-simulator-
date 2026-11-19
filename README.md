# Fire Ant Lab

AI Ant Brain Simulator · Colony training

Fire Ant Lab is a mobile-first 3D colony simulation inspired by the red imported fire ant (*Solenopsis invicta*). Each run starts with one stationary queen and one adult worker. The open world streams seeded terrain with scattered food and water. Workers discover nearby patches, share those locations and their needs, and choose among scouting, eating, drinking, nursing brood, supplying the colony, grooming, and resting.

| Setting | Default |
| --- | ---: |
| Egg interval | 10 simulated seconds |
| Egg, larva, and pupa duration | 60 simulated seconds each |
| Adult age limit | Unlimited |
| Worker cap | 40 |
| Failure restart | On |
| Online learning | On |
| Mutation amplitude per weight | 0.10 |

Eggs accumulate around the queen. Workers can pick up brood and carry it to the nursery. The care meter applies to all three stages. Larvae also require food. The queen depends on workers for food and water. Adults can die when either reserve runs out. If the queen dies or the last worker is lost, the run fails. With auto-restart enabled, a new world starts four simulated seconds later.

Food and water deliveries trigger different mouthpart motions in the queen. The queen flexes her abdomen to place each egg at the rear of the nest. Antennae sweep independently and reach for nearby contacts. Workers exchange needs and known resource locations when they touch. Touch also samples the queen, brood, food, water, and terrain features using approximate collision shapes. **Worker & brain** shows the inspected worker’s most recent contact.

All visible workers use the same articulated anatomy. WebGL draws their shared parts in batches and updates the world tiles when the camera moves between chunks. The compatibility renderer projects the same worker rigs onto a canvas.

The movement solver checks fitted volumes for the head, mouth, thorax, waist, and abdomen. Workers turn around obstructions, sidestep, and raise their stance when a path over a lower neighboring body is available. Leg trajectories and the two antennae check the same surfaces. Feet can plant on an exposed shell, and feelers retract in tight gaps. These fitted volumes approximate the rendered cuticle.

## Training

Each worker owns a trainable action-value policy. Its weights score options using cues for deficit, distance, cargo, and nearby demand. The founder starts with hand-set weights that make basic survival possible. Small exploratory variations sometimes favor a different task. Temporal-difference updates use rewards from successful deliveries, self-care, scouting, and brood care, with a cost for time spent. The default checkpoint score includes survival time, hatchings, deliveries, losses, and the queen's reserves.

Dirt accumulates separately on eleven areas. Ground contact dirties each leg according to the terrain under that foot, and antenna contact can pick up dirt or wash it away in water. The worker learns which areas to clean and adjusts its reach calibration based on contact and dirt removed. It starts with the ability to reach and wipe those areas using its articulated joints. Saved policies from earlier releases keep their existing weights and use their previous grooming weights to initialize each targeted cleaning action.

Each egg gets a snapshot of the most recently matured worker's current weights and reach calibration with small independent mutations. The first eggs inherit from the founder. Hatching creates an independent worker that continues to learn from its own outcomes. The highest-scoring checkpoint so far is saved in this browser and seeds the next founder. The learned policy and survival outcome depend on the world seed and settings.

## Controls

- **Nest** centers the queen and nursery. **Worker** follows the current worker. **Explore** lets you pan across the world with two fingers or a right-button drag.
- Tap or click a worker or the queen to see their own activity and reserves. The worker card also shows age, generation, antenna contact, last cleaned area, and a breakdown of dirt by body part.
- **Settings** opens the lifecycle, world, training, and worker panels. Change the simulation clock speed from the bottom toolbar. Speed applies to the full model clock, including decay and development.
- **Training** shows the seed, policy updates, hatchings, care visits, and deliveries. **Start new run** generates a fresh world from the saved checkpoint.
- **Worker & brain** shows the selected worker's generation, reserves, and reward. The optional 250,000-neuron anatomical viewer runs a separate spiking readout driven by that worker's sensor and movement signals. The regional cell counts and 750,000 individual connections in the anatomy model are estimates.

## Run locally

Requires Node.js 22.12+ or 24.

```sh
npm ci
npm run dev
npm test
npm run build
```

For a local offline-install test, run `npm run preview` after building. To run the browser smoke checks, install the test browser with `npx playwright install chromium` and run `npm run test:browser`.

## Phone installation

GitHub Pages can deploy the `Deploy Fire Ant Lab` workflow after the repository's **Settings → Pages → Source** is set to **GitHub Actions**. The resulting Actions run exposes the live site link in its deployment and run summary.

Open the deployment link. On iOS, use **Safari → Share → Add to Home Screen** and turn on **Open as Web App** where available. On Android, use **Chrome → Install app** or **Add to Home screen**. The production app caches its assets for offline use after the first successful load.

## Research

- [AntWeb fire ant worker specimen views](https://www.antweb.org/images.do?caste=worker&genus=solenopsis&project=allantwebants&rank=species&species=invicta&subfamily=myrmicinae)
- [Worker proportions and body-size scaling](https://doi.org/10.1093/jis/3.1.2)
- [Worker morphology, UF/IFAS](https://ask.ifas.ufl.edu/publication/in352)
- [Fire ant motion and stability in tunnels](https://doi.org/10.1073/pnas.1302428110)
- [Comparative tripod stepping patterns in ants](https://pubmed.ncbi.nlm.nih.gov/9317406/)
- [Comparative ant neck and thorax anatomy](https://doi.org/10.1186/s12983-020-00375-9)
- [Ant head movements during walking and scanning](https://pmc.ncbi.nlm.nih.gov/articles/PMC3886322/)
- [Comparative ant abdominal articulation and musculature](https://doi.org/10.1002/jmor.21471)

- [Fire-ant worker neuroanatomy across subcastes](https://doi.org/10.1371/journal.pone.0083966)
- [Comparative ant neuropil and fiber atlas](https://doi.org/10.3389/fnana.2014.00166)
- [Hymenoptera brain-cell allometry](https://doi.org/10.1098/rspb.2021.0199)
- [Comparative single-cell atlas and Kenyon-cell proportions](https://doi.org/10.1038/s41559-022-01784-1)
- [Insect central-complex navigation and steering](https://pmc.ncbi.nlm.nih.gov/articles/PMC6474401/)
- [Fire-ant worker foraging, scouting, and recruitment](https://doi.org/10.1673/031.011.0126)
- [Fire-ant trail orientation behavior](https://www.ars.usda.gov/arsuserfiles/60360510/publications/Vander_Meer_et_al-1990%28M-2399%29.pdf)
