import { createCn } from "cn/config";

/**
 * Class merging aware of the Harvest Kids type scale: without it,
 * `text-matricule` (a font size) would be mistaken for a colour and
 * dropped next to `text-nuit`.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["display", "h1", "h2", "h3", "matricule", "body-lg", "body", "label", "caption"] },
      ],
    },
  },
});
