// oceanocratie.fr — combined scripts
// Auto-extracted from inline <script> blocks

(function() {
    'use strict';
    const isMobile = window.innerWidth <= 768;
    const canvas = document.getElementById('ocean-canvas');
    const fallback = document.getElementById('ocean-fallback');

    // GPU tier detection — skip WebGL on weak GPUs
    function isWeakGPU() {
      try {
        const c = document.createElement('canvas');
        const g = c.getContext('webgl');
        if (!g) return true;
        const dbg = g.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          const r = g.getParameter(dbg.UNMASKED_RENDERER_WEBGL).toLowerCase();
          if (/swiftshader|llvmpipe|mesa/.test(r)) return true;
        }
      } catch(e) { return true; }
      return false;
    }

    if (isMobile || !canvas || isWeakGPU()) {
      if (canvas) canvas.style.display = 'none';
      initNonGL();
      return;
    }

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) { initNonGL(); return; }

    fallback.classList.add('hidden');

    // ── Fullscreen quad ──
    const quadVerts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // ── Compile shaders ──
    function compileShader(src, type) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    }

    const vertSrc = `
      attribute vec2 aPos;
      void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
    `;

    // ════════════════════════════════════════════════════════════
    // FRAGMENT SHADER — Raymarched moonlit ocean
    // Inspired by "Seascape" by Alexander Alekseev (TDM), 2014
    // CC BY-NC-SA 3.0 — adapted for nighttime scene
    // ════════════════════════════════════════════════════════════
    const fragSrc = `
      precision highp float;
      uniform float iTime;
      uniform vec2 iResolution;

      // ── Constants ──
      const int NUM_STEPS = 8;
      const int ITER_GEOMETRY = 3;
      const int ITER_FRAGMENT = 5;
      const float PI = 3.141592;
      const float EPSILON = 1e-3;

      // ── Ocean parameters ──
      const float SEA_HEIGHT = 0.6;
      const float SEA_CHOPPY = 4.0;
      const float SEA_SPEED  = 0.35;
      const float SEA_FREQ   = 0.16;

      // ── Night ocean colors ──
      const vec3 SEA_BASE       = vec3(0.0, 0.06, 0.12);
      const vec3 SEA_WATER      = vec3(0.35, 0.5, 0.55);
      const vec3 SEA_DEEP       = vec3(0.0, 0.02, 0.06);
      const vec3 MOON_COLOR     = vec3(0.75, 0.8, 0.95);

      // ── Octave rotation ──
      mat2 octave_m = mat2(1.7, 1.1, -1.3, 1.5);

      // ── Math utils ──
      mat3 fromEuler(vec3 ang) {
        vec2 a1 = vec2(sin(ang.x),cos(ang.x));
        vec2 a2 = vec2(sin(ang.y),cos(ang.y));
        vec2 a3 = vec2(sin(ang.z),cos(ang.z));
        mat3 m;
        m[0] = vec3(a1.y*a3.y+a1.x*a2.x*a3.x, a1.y*a2.x*a3.x+a3.y*a1.x, -a2.y*a3.x);
        m[1] = vec3(-a2.y*a1.x, a1.y*a2.y, a2.x);
        m[2] = vec3(a3.y*a1.x*a2.x+a1.y*a3.x, a1.x*a3.x-a1.y*a3.y*a2.x, a2.y*a3.y);
        return m;
      }

      float hash(vec2 p) {
        float h = dot(p, vec2(127.1, 311.7));
        return fract(sin(h) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return -1.0 + 2.0 * mix(
          mix(hash(i), hash(i+vec2(1.0,0.0)), u.x),
          mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x),
          u.y
        );
      }

      // ── Lighting ──
      float diffuse(vec3 n, vec3 l, float p) {
        return pow(dot(n,l) * 0.4 + 0.6, p);
      }

      float specular(vec3 n, vec3 l, vec3 e, float s) {
        float nrm = (s + 8.0) / (PI * 8.0);
        return pow(max(dot(reflect(e,n),l), 0.0), s) * nrm;
      }

      // ══════════════════════════
      // NIGHT SKY with moon & stars
      // ══════════════════════════
      vec3 getSkyColor(vec3 e) {
        e.y = max(e.y, 0.0);

        // Night gradient — deep blue to near-black
        vec3 sky = vec3(0.005, 0.01, 0.03);
        sky += vec3(0.01, 0.02, 0.06) * (1.0 - e.y);

        // Horizon glow — subtle blue-purple band
        float horizonGlow = pow(1.0 - e.y, 12.0);
        sky += vec3(0.04, 0.05, 0.15) * horizonGlow;

        // Stars — single optimized layer with varied brightness
        vec3 en = normalize(e);
        vec2 starUV = vec2(atan(en.z, en.x), asin(en.y));
        float skyMask = smoothstep(0.02, 0.15, e.y);

        vec2 grid1 = starUV * 180.0;
        vec2 cell1 = floor(grid1);
        vec2 frac1 = fract(grid1) - 0.5;
        float id1 = hash(cell1);
        vec2 starOff1 = vec2(hash(cell1 + 71.0), hash(cell1 + 113.0)) - 0.5;
        float dist1 = length(frac1 - starOff1 * 0.6);
        float twinkle = sin(iTime * 1.5 + id1 * 52.0) * 0.35 + 0.65;
        float bright = smoothstep(0.94, 1.0, id1);
        float star1 = bright * smoothstep(0.05, 0.0, dist1) * skyMask * twinkle;
        sky += vec3(0.7, 0.75, 0.95) * star1 * 2.5;
        float glow1 = bright * smoothstep(0.12, 0.0, dist1) * skyMask;
        sky += vec3(0.3, 0.35, 0.55) * glow1 * 0.2;

        // Moon
        vec3 moonDir = normalize(vec3(0.3, 0.35, -0.88));
        float moonAngle = max(dot(en, moonDir), 0.0);
        float moonDisc = smoothstep(0.9996, 0.9999, moonAngle);
        sky += vec3(0.95, 0.95, 1.0) * moonDisc * 4.0;
        float moonGlow = pow(moonAngle, 256.0) * 2.0;
        sky += MOON_COLOR * moonGlow;
        float moonAtmo = pow(moonAngle, 32.0) * 0.2;
        sky += vec3(0.12, 0.15, 0.25) * moonAtmo;
        float moonWide = pow(moonAngle, 8.0) * 0.08;
        sky += vec3(0.08, 0.1, 0.2) * moonWide;

        return sky;
      }

      // ══════════════════════════
      // WAVE FUNCTION
      // ══════════════════════════
      float sea_octave(vec2 uv, float choppy) {
        uv += noise(uv);
        // Rotate UV to break axis-aligned seams
        float c = 0.8660254; // cos(30deg)
        float s2 = 0.5;     // sin(30deg)
        uv = vec2(uv.x * c - uv.y * s2, uv.x * s2 + uv.y * c);
        vec2 wv = 1.0 - abs(sin(uv));
        vec2 swv = abs(cos(uv));
        wv = mix(wv, swv, wv);
        return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);
      }

      float map(vec3 p) {
        float SEA_TIME = iTime * SEA_SPEED;
        float freq = SEA_FREQ;
        float amp = SEA_HEIGHT;
        float choppy = SEA_CHOPPY;
        vec2 uv = p.xz; uv.x *= 0.75;
        float d, h = 0.0;
        for(int i = 0; i < ITER_GEOMETRY; i++) {
          d = sea_octave((uv + vec2(SEA_TIME * 1.0, SEA_TIME * 0.8)) * freq, choppy);
          d += sea_octave((uv + vec2(SEA_TIME * 0.6, SEA_TIME * 0.4)) * freq, choppy);
          h += d * amp;
          uv *= octave_m;
          freq *= 1.9;
          amp *= 0.22;
          choppy = mix(choppy, 1.0, 0.2);
        }
        return p.y - h;
      }

      float map_detailed(vec3 p) {
        float SEA_TIME = iTime * SEA_SPEED;
        float freq = SEA_FREQ;
        float amp = SEA_HEIGHT;
        float choppy = SEA_CHOPPY;
        vec2 uv = p.xz; uv.x *= 0.75;
        float d, h = 0.0;
        for(int i = 0; i < ITER_FRAGMENT; i++) {
          d = sea_octave((uv + vec2(SEA_TIME * 1.0, SEA_TIME * 0.8)) * freq, choppy);
          d += sea_octave((uv + vec2(SEA_TIME * 0.6, SEA_TIME * 0.4)) * freq, choppy);
          h += d * amp;
          uv *= octave_m;
          freq *= 1.9;
          amp *= 0.22;
          choppy = mix(choppy, 1.0, 0.2);
        }
        return p.y - h;
      }

      vec3 getNormal(vec3 p, float eps) {
        vec3 n;
        n.y = map_detailed(p);
        n.x = map_detailed(vec3(p.x+eps, p.y, p.z)) - n.y;
        n.z = map_detailed(vec3(p.x, p.y, p.z+eps)) - n.y;
        n.y = eps;
        return normalize(n);
      }

      float heightMapTracing(vec3 ori, vec3 dir, out vec3 p) {
        float tm = 0.0;
        float tx = 1000.0;
        float hx = map(ori + dir * tx);
        if(hx > 0.0) return tx;
        float hm = map(ori + dir * tm);
        float tmid = 0.0;
        for(int i = 0; i < NUM_STEPS; i++) {
          tmid = mix(tm, tx, hm / (hm - hx));
          p = ori + dir * tmid;
          float hmid = map(p);
          if(hmid < 0.0) { tx = tmid; hx = hmid; }
          else { tm = tmid; hm = hmid; }
        }
        return tmid;
      }

      vec3 getSeaColor(vec3 p, vec3 n, vec3 l, vec3 eye, vec3 dist) {
        float fresnel = 1.0 - max(dot(n, -eye), 0.0);
        fresnel = pow(fresnel, 3.0) * 0.75;
        vec3 reflected = getSkyColor(reflect(eye, n));
        vec3 refracted = SEA_BASE + diffuse(n, l, 80.0) * SEA_WATER * 0.15;
        vec3 color = mix(refracted, reflected, fresnel);
        float atten = max(1.0 - dot(dist,dist) * 0.001, 0.0);
        color += SEA_WATER * (p.y - SEA_HEIGHT) * 0.2 * atten;
        float sss = pow(max(dot(eye, l), 0.0), 2.0) * smoothstep(-0.1, 0.3, p.y - SEA_HEIGHT * 0.5);
        color += vec3(0.0, 0.12, 0.16) * sss * 0.4;
        color += vec3(specular(n, l, eye, 120.0)) * MOON_COLOR * 1.2;
        color += vec3(specular(n, l, eye, 20.0)) * MOON_COLOR * 0.15;
        float foam = smoothstep(SEA_HEIGHT * 0.85, SEA_HEIGHT * 1.1, p.y);
        float foamNoise = hash(p.xz * 8.0);
        foam *= smoothstep(0.4, 0.8, foamNoise);
        color += vec3(0.35, 0.4, 0.5) * foam * 0.2;
        return color;
      }

      void main() {
        float EPSILON_NRM = 0.1 / iResolution.x;
        vec2 uv = gl_FragCoord.xy / iResolution.xy;
        uv = uv * 2.0 - 1.0;
        uv.x *= iResolution.x / iResolution.y;
        float time = iTime * 0.15;
        vec3 ang = vec3(sin(time*2.1)*0.06, sin(time)*0.08+0.25, time*0.5);
        vec3 ori = vec3(0.0, 3.5, time * 8.0);
        vec3 dir = normalize(vec3(uv.xy, -2.0));
        dir.z += length(uv) * 0.14;
        dir = normalize(dir) * fromEuler(ang);
        vec3 light = normalize(vec3(0.3, 0.35, -0.88));
        vec3 p;
        heightMapTracing(ori, dir, p);
        vec3 dist = p - ori;
        vec3 n = getNormal(p, dot(dist,dist) * EPSILON_NRM);
        vec3 sky = getSkyColor(dir);
        vec3 sea = getSeaColor(p, n, light, dir, dist);
        vec3 color = mix(sky, sea, pow(smoothstep(0.0, -0.05, dir.y), 0.3));
        float grain = (hash(gl_FragCoord.xy + iTime) - 0.5) * 0.03;
        color += grain;
        color = color * (2.51 * color + 0.03) / (color * (2.43 * color + 0.59) + 0.14);
        vec2 vig = gl_FragCoord.xy / iResolution.xy;
        float v = 1.0 - pow(length(vig - 0.5) * 1.1, 2.5);
        color *= mix(0.7, 1.0, v);
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    // ── Build program ──
    const vs = compileShader(vertSrc, gl.VERTEX_SHADER);
    const fs = compileShader(fragSrc, gl.FRAGMENT_SHADER);
    if (!vs || !fs) { initNonGL(); return; }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Link error:', gl.getProgramInfoLog(prog));
      initNonGL();
      return;
    }
    gl.useProgram(prog);

    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'iTime');
    const uRes = gl.getUniformLocation(prog, 'iResolution');

    let dpr = Math.min(window.devicePixelRatio, 1.5);
    function resize() {
      const w = window.innerWidth, h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    let startTime = performance.now();
    function render() {
      const t = (performance.now() - startTime) * 0.001;
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(render);
    }

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      canvas.style.display = 'none';
      fallback.classList.remove('hidden');
    });

    render();

    function initNonGL() {}
  })();

  // ── Spray particles ──
  (function() {
    const spray = document.getElementById('spray');
    if (!spray || window.innerWidth <= 768) return;
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      p.className = 'spray__particle';
      p.style.left = (Math.random() * 100) + '%';
      p.style.bottom = (15 + Math.random() * 35) + '%';
      p.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
      p.style.animationDuration = (4 + Math.random() * 6) + 's';
      p.style.animationDelay = (Math.random() * 8) + 's';
      p.style.width = p.style.height = (1.5 + Math.random() * 3) + 'px';
      spray.appendChild(p);
    }
  })();

  // ── Water droplets on screen — windshield effect ──
  (function() {
    if (window.innerWidth <= 768) return;
    var dc = document.getElementById('droplets-canvas');
    if (!dc) return;
    var ctx = dc.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio, 2);

    function resizeDroplets() {
      dc.width = window.innerWidth * dpr;
      dc.height = window.innerHeight * dpr;
      dc.style.width = window.innerWidth + 'px';
      dc.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
    }
    resizeDroplets();
    window.addEventListener('resize', resizeDroplets);

    var drops = [];
    var smears = [];
    var MAX_DROPS = 8;
    var W = function() { return window.innerWidth; };
    var H = function() { return window.innerHeight; };

    function spawnDrop() {
      if (drops.length >= MAX_DROPS) return;
      var size = 3 + Math.random() * 6;
      // Drops appear ON the glass surface at a random position (like condensation or splatter)
      var startX = 20 + Math.random() * (W() - 40);
      var startY = -10 + Math.random() * (H() * 0.3);
      drops.push({
        x: startX,
        y: startY,
        r: size,
        vy: 0,
        vx: 0,
        opacity: 0.0,
        fadeIn: true,
        growing: true,
        growTime: 0,
        growDuration: 40 + Math.random() * 80,
        life: 0,
        trail: [],
        wobble: Math.random() * 6.28,
        wobbleSpeed: 0.02 + Math.random() * 0.03,
        friction: 0.997 + Math.random() * 0.002,
        stopped: false,
        sliding: false,
        slideDelay: 60 + Math.random() * 120
      });
    }

    function drawDrop(d) {
      // Trail — smear streak behind (windshield trail)
      if (d.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(d.trail[0].x, d.trail[0].y);
        for (var i = 1; i < d.trail.length; i++) {
          ctx.lineTo(d.trail[i].x, d.trail[i].y);
        }
        ctx.strokeStyle = 'rgba(150, 195, 240, ' + (d.opacity * 0.12) + ')';
        ctx.lineWidth = d.r * 0.6;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(d.trail[0].x, d.trail[0].y);
        for (var i = 1; i < d.trail.length; i++) {
          ctx.lineTo(d.trail[i].x, d.trail[i].y);
        }
        ctx.strokeStyle = 'rgba(200, 225, 255, ' + (d.opacity * 0.06) + ')';
        ctx.lineWidth = d.r * 0.2;
        ctx.stroke();
      }

      // Main drop body — flattened oval (windshield drop shape)
      ctx.save();
      ctx.translate(d.x, d.y);
      var rx = d.r * 1.0;
      var ry = d.r * 0.7;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);

      var g = ctx.createRadialGradient(
        -d.r * 0.15, -d.r * 0.1, d.r * 0.05,
        0, 0, d.r * 1.1
      );
      g.addColorStop(0, 'rgba(220, 240, 255, ' + (d.opacity * 0.45) + ')');
      g.addColorStop(0.3, 'rgba(150, 200, 255, ' + (d.opacity * 0.25) + ')');
      g.addColorStop(0.6, 'rgba(100, 170, 230, ' + (d.opacity * 0.12) + ')');
      g.addColorStop(1, 'rgba(80, 140, 200, 0)');
      ctx.fillStyle = g;
      ctx.fill();

      ctx.strokeStyle = 'rgba(200, 230, 255, ' + (d.opacity * 0.2) + ')';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(-d.r * 0.2, -d.r * 0.15, d.r * 0.22, d.r * 0.12, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (d.opacity * 0.55) + ')';
      ctx.fill();

      ctx.restore();
    }

    function drawSmear(s) {
      var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0, 'rgba(160, 200, 240, ' + (s.opacity * 0.1) + ')');
      g.addColorStop(0.5, 'rgba(140, 185, 230, ' + (s.opacity * 0.05) + ')');
      g.addColorStop(1, 'rgba(100, 150, 200, 0)');
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    var spawnTimer = 0;
    function animateDroplets() {
      ctx.clearRect(0, 0, W(), H());

      // Draw smears first (behind drops)
      for (var i = smears.length - 1; i >= 0; i--) {
        var s = smears[i];
        s.life++;
        s.opacity *= 0.992;
        if (s.opacity < 0.005 || s.life > s.maxLife) {
          smears.splice(i, 1);
          continue;
        }
        drawSmear(s);
      }

      // Spawn new drops
      spawnTimer++;
      if (spawnTimer > 100 + Math.random() * 180) {
        spawnDrop();
        spawnTimer = 0;
      }

      // Update & draw drops on glass surface
      for (var i = drops.length - 1; i >= 0; i--) {
        var d = drops[i];
        d.life++;

        // Phase 1: Drop appears and grows on glass (condensation effect)
        if (d.growing) {
          d.growTime++;
          if (d.growTime >= d.growDuration) {
            d.growing = false;
          }
        }

        // Phase 2: After growing, wait then start sliding
        if (!d.growing && !d.sliding) {
          d.slideDelay--;
          if (d.slideDelay <= 0) {
            d.sliding = true;
          }
        }

        // Phase 3: Slide down glass surface under gravity
        if (d.sliding) {
          d.vy += 0.012;
          d.wobble += d.wobbleSpeed;
          d.x += d.vx + Math.sin(d.wobble) * 0.25;
          d.y += d.vy;

          d.vy *= d.friction;
          d.vx *= d.friction;

          d.trail.push({ x: d.x, y: d.y });
          if (d.trail.length > 30) d.trail.shift();

        }

        // Fade in gently (appears on glass)
        if (d.fadeIn) {
          d.opacity = Math.min(d.opacity + 0.015, 0.75);
          if (d.opacity >= 0.75) d.fadeIn = false;
        }

        // Remove if off screen
        if (d.y > H() + 20 || d.x < -20 || d.x > W() + 20) {
          drops.splice(i, 1);
          continue;
        }

        drawDrop(d);
      }

      requestAnimationFrame(animateDroplets);
    }

    setTimeout(function() {
      spawnDrop();
      animateDroplets();
    }, 2000);
  })();

  // ── Scroll reveal ──
  (function() {
    const els = document.querySelectorAll('.reveal');
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    els.forEach(el => obs.observe(el));
  })();

// ══════════════════════════════════════════════════════════════
    // Waitlist form — Google Sheets integration via Apps Script
    //
    // HOW TO SET UP:
    // 1. Create a Google Sheet
    // 2. Go to Extensions > Apps Script
    // 3. Paste this code in the Apps Script editor:
    //
    //    function doPost(e) {
    //      var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    //      var data = JSON.parse(e.postData.contents);
    //      sheet.appendRow([new Date(), data.email]);
    //      return ContentService
    //        .createTextOutput(JSON.stringify({ result: 'success' }))
    //        .setMimeType(ContentService.MimeType.JSON);
    //    }
    //
    // 4. Deploy as Web App:
    //    - Click Deploy > New deployment
    //    - Select type: Web app
    //    - Execute as: Me
    //    - Who has access: Anyone
    //    - Click Deploy and copy the URL
    // 5. Replace PLACEHOLDER_DEPLOY_ID below with your deployment ID
    // ══════════════════════════════════════════════════════════════
    const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby5H79EBC9F1z9T_Yx68pLCCg8TbjFuPmHKTyTD6lhvSOGpBhdb5hqt7DSFotBV1rTXyQ/exec';

    const form = document.getElementById('waitlist-form');
    const msg = document.getElementById('waitlist-msg');

    // hCaptcha invisible callback — called after captcha passes
    function onCaptchaPass(token) {
      const fd = new FormData(form);
      const email = fd.get('email');
      if (!email) return;

      const btn = form.querySelector('.waitlist__btn');
      btn.disabled = true;
      btn.textContent = 'Envoi...';
      msg.textContent = '';
      msg.classList.remove('error');

      fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, captcha: token })
      })
      .then(() => {
        msg.textContent = 'Merci ! Vous serez pr\u00e9venu(e) de la sortie.';
        msg.classList.remove('error');
        form.reset();
        if (typeof hcaptcha !== 'undefined') hcaptcha.reset();
        if (typeof gtag === 'function') {
          gtag('event', 'sign_up', { method: 'waitlist', event_category: 'conversion' });
        }
      })
      .catch((err) => {
        console.error('Waitlist submission error:', err);
        msg.textContent = 'Erreur lors de l\'envoi. Veuillez r\u00e9essayer.';
        msg.classList.add('error');
      })
      .finally(() => {
        btn.disabled = false;
        btn.textContent = 'Me pr\u00e9venir';
      });
    }

    // Validate email before hCaptcha triggers
    form?.addEventListener('submit', (e) => {
      const email = new FormData(form).get('email');
      if (!email) {
        e.preventDefault();
        msg.textContent = 'Veuillez entrer votre email.';
        msg.classList.add('error');
        return;
      }
      // Guard: if hCaptcha not loaded yet, prevent default and show message
      if (typeof hcaptcha === 'undefined') {
        e.preventDefault();
        msg.textContent = 'Chargement en cours, veuillez réessayer dans un instant.';
        msg.classList.remove('error');
      }
    });

(function() {
    var loaded = false;
    function loadHCaptcha() {
      if (loaded) return;
      loaded = true;
      var s = document.createElement('script');
      s.src = 'https://js.hcaptcha.com/1/api.js';
      s.async = true;
      document.head.appendChild(s);
    }
    var el = document.querySelector('.waitlist');
    if (el && 'IntersectionObserver' in window) {
      new IntersectionObserver(function(entries, obs) {
        if (entries[0].isIntersecting) { loadHCaptcha(); obs.disconnect(); }
      }, { rootMargin: '300px' }).observe(el);
    } else if (el) {
      loadHCaptcha();
    }
  })();

