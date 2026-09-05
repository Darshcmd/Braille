import lottie, {AnimationItem} from 'lottie-web';

// Fallback bot animation (simple shapes) used when the LottieFiles URL can't be loaded
const FALLBACK_BOT = {
  v: '5.7.1', fr: 30, ip: 0, op: 60, w: 200, h: 200, nm: 'bot',
  layers: [
    {
      ty: 4, nm: 'body', sr: 1, ks: {
        o: {a: 0, k: 100}, r: {a: 0, k: 0},
        p: {a: 0, k: [100, 100, 0]}, a: {a: 0, k: [0, 0, 0]},
        s: {a: 1, k: [
          {t: 0, s: [100, 100, 100], e: [105, 95, 100]},
          {t: 30, s: [105, 95, 100], e: [100, 100, 100]},
          {t: 60, s: [100, 100, 100]}
        ]}
      },
      shapes: [{
        ty: 'gr', it: [
          {ty: 'rc', p: {a: 0, k: [0, 0]}, s: {a: 0, k: [80, 80]}, r: {a: 0, k: 16}},
          {ty: 'fl', c: {a: 0, k: [0.31, 0.27, 0.9, 1]}, o: {a: 0, k: 100}},
          {ty: 'tr'}
        ]
      }],
      ip: 0, op: 60
    },
    {
      ty: 4, nm: 'eye', sr: 1, ks: {
        o: {a: 0, k: 100}, r: {a: 0, k: 0},
        p: {a: 0, k: [100, 85, 0]}, a: {a: 0, k: [0, 0, 0]},
        s: {a: 0, k: [100, 100, 100]}
      },
      shapes: [{
        ty: 'gr', it: [
          {ty: 'el', p: {a: 0, k: [0, 0]}, s: {a: 0, k: [12, 12]}},
          {ty: 'fl', c: {a: 0, k: [1, 1, 1, 1]}, o: {a: 0, k: 100}},
          {ty: 'tr'}
        ]
      }],
      ip: 0, op: 60
    }
  ]
};

export function initLottie(container: HTMLElement): AnimationItem {
  // Try to load the ai-robo animation from LottieFiles at runtime
  const anim = lottie.loadAnimation({
    container,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    animationData: FALLBACK_BOT,
  });

  // Attempt to fetch the real animation; replace if successful
  fetch('https://lottie.host/ldhczFXzZC.json')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      anim.destroy();
      lottie.loadAnimation({
        container,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: data,
      });
    })
    .catch(() => { /* keep fallback */ });

  return anim;
}