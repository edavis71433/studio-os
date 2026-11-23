# The stand-in photos (thumbs/stand-ins/)

One photo per kind of business, in `thumbs/stand-ins/<file>`. This list lives here, not beside them, because everything under `thumbs/` is published with the app and the build refuses to publish a document. A first draft made in + New site opens with its kind's photo until the owner swaps in their own (lib/stand_in.ts), and the design pictures and "See it full size" use them (lib/kind_samples.json, scripts/thumbnails).

Photos from Pexels (https://www.pexels.com), used under the Pexels License (https://www.pexels.com/license/): free for commercial use on websites and apps, credit not required, credited here anyway. Approved by the studio owner on Nov 22 2026. Each was cropped to 1600 x 1000 and saved again without its camera data.

| File | Kind | Photographer | Photo |
|---|---|---|---|
| food.jpg | Restaurant or café | Rachel Claire | https://www.pexels.com/photo/wine-with-cheese-platter-5865427/ |
| beauty.jpg | Salon or spa | Max Vakhtbovych | https://www.pexels.com/photo/photo-of-the-interior-of-a-salon-7750108/ |
| home.jpg | Home services | Sergei Starostin | https://www.pexels.com/photo/professional-plumber-installing-a-radiator-pipe-29226620/ |
| health.jpg | Health care | Cedric Fauntleroy | https://www.pexels.com/photo/side-view-of-a-dental-chair-in-a-clinic-4269277/ |
| professional.jpg | Professional | Mikhail Nilov | https://www.pexels.com/photo/laptop-and-stationery-items-on-wooden-table-top-7679173/ |
| retail.jpg | Shop | alleksana | https://www.pexels.com/photo/bouquets-and-plants-in-flower-shop-4238333/ |
| fitness.jpg | Fitness | RDNE Stock project | https://www.pexels.com/photo/an-empty-boxing-ring-8612028/ |
| creative.jpg | Photo and creative | Jonathan Borba | https://www.pexels.com/photo/elegant-indoor-wedding-reception-setup-35985211/ |
| community.jpg | Nonprofit or church | Julia M Cameron | https://www.pexels.com/photo/people-preparing-food-packs-6995247/ |
| other.jpg | Something else | christian buehner | https://www.pexels.com/photo/a-mechanic-working-on-a-car-engine-27665740/ |

These are built-in sample pictures, not a photo library: nothing lets people browse or download them as one. If a photo ever has to go, `node scripts/stand-ins/make.mjs <folder>` draws a plain stand-in of the same name to put back.
