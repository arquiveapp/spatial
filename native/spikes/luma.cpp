// SPDX-License-Identifier: MIT
// Original diagnostic kernel: integer Rec.601 approximation; no tracking claims.
#include <stdint.h>
#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif
static uint8_t pixels[640 * 360 * 4];
static uint8_t luma[640 * 360];
extern "C" {
uint8_t* input() { return pixels; }
uint8_t* output() { return luma; }
int is_simd() {
#ifdef __wasm_simd128__
 return 1;
#else
 return 0;
#endif
}
uint32_t process(int count) {
 if (count < 0 || count > 640 * 360) return 0;
 for (int i=0; i<count; ++i) luma[i] = (77*pixels[4*i] + 150*pixels[4*i+1] + 29*pixels[4*i+2]) >> 8;
 uint32_t sum=0; int i=0;
#ifdef __wasm_simd128__
 for (; i+16<=count; i+=16) {
  v128_t v=wasm_v128_load(luma+i);
  v128_t a=wasm_u16x8_extadd_pairwise_u8x16(v);
  v128_t b=wasm_u32x4_extadd_pairwise_u16x8(a);
  sum += wasm_u32x4_extract_lane(b,0)+wasm_u32x4_extract_lane(b,1)+wasm_u32x4_extract_lane(b,2)+wasm_u32x4_extract_lane(b,3);
 }
#endif
 for (; i<count; ++i) sum+=luma[i];
 return sum;
}
}
