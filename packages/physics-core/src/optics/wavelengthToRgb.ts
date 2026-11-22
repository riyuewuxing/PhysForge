export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly hex: string;
}

/**
 * 将可见光波长 (380 nm - 780 nm) 映射为 sRGB 与十六进制颜色
 */
export function wavelengthToRgb(wavelengthNm: number): RgbColor {
  let r = 0;
  let g = 0;
  let b = 0;

  if (wavelengthNm >= 380 && wavelengthNm < 440) {
    r = -(wavelengthNm - 440) / (440 - 380);
    g = 0;
    b = 1;
  } else if (wavelengthNm >= 440 && wavelengthNm < 490) {
    r = 0;
    g = (wavelengthNm - 440) / (490 - 440);
    b = 1;
  } else if (wavelengthNm >= 490 && wavelengthNm < 510) {
    r = 0;
    g = 1;
    b = -(wavelengthNm - 510) / (510 - 490);
  } else if (wavelengthNm >= 510 && wavelengthNm < 580) {
    r = (wavelengthNm - 510) / (580 - 510);
    g = 1;
    b = 0;
  } else if (wavelengthNm >= 580 && wavelengthNm < 645) {
    r = 1;
    g = -(wavelengthNm - 645) / (645 - 580);
    b = 0;
  } else if (wavelengthNm >= 645 && wavelengthNm <= 780) {
    r = 1;
    g = 0;
    b = 0;
  }

  let factor = 0;
  if (wavelengthNm >= 380 && wavelengthNm < 420) {
    factor = 0.3 + (0.7 * (wavelengthNm - 380)) / (420 - 380);
  } else if (wavelengthNm >= 420 && wavelengthNm <= 700) {
    factor = 1.0;
  } else if (wavelengthNm > 700 && wavelengthNm <= 780) {
    factor = 0.3 + (0.7 * (780 - wavelengthNm)) / (780 - 700);
  }

  const gamma = 0.8;
  const adjust = (c: number) =>
    c === 0 ? 0 : Math.round(255 * Math.pow(c * factor, gamma));

  const ri = adjust(r);
  const gi = adjust(g);
  const bi = adjust(b);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');

  return {
    r: ri,
    g: gi,
    b: bi,
    hex: `#${toHex(ri)}${toHex(gi)}${toHex(bi)}`
  };
}
