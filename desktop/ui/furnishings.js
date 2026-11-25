import { furnitureChannel } from "./furniture-channel.js";

const publish = furnitureChannel(data => {
  if (!Array.isArray(data?.tiles)) return;
  const props = data.tiles.map(({x, y, width, height, pixels}) => {
    const tile = document.createElement("canvas");
    tile.width = pixels.width;
    tile.height = pixels.height;
    Object.assign(tile.style, {
      left: x + "px", top: y + "px", width: width + "px", height: height + "px",
    });
    tile.getContext("2d").putImageData(pixels, 0, 0);
    return tile;
  });
  document.body.replaceChildren(...props);
});
publish("ready");
