(function () {
  const COLORS = [
    [0.89, 0.71, 0.34],
    [0.42, 0.62, 0.28],
    [0.55, 0.39, 0.22],
    [0.48, 0.48, 0.5],
    [0.4, 0.4, 0.42],
    [0.2, 0.2, 0.22],
    [0.78, 0.64, 0.55],
    [0.86, 0.72, 0.28],
    [0.42, 0.82, 0.88],
    [0.75, 0.24, 0.22],
    [0.3, 0.42, 0.78],
    [0.74, 0.46, 0.28],
    [0.3, 0.3, 0.34],
    [0.25, 0.48, 0.75],
    [0.9, 0.38, 0.1],
    [0.5, 0.35, 0.18],
    [0.28, 0.5, 0.22],
    [0.74, 0.58, 0.34],
    [0.84, 0.76, 0.5],
    [0.55, 0.52, 0.48],
    [0.14, 0.14, 0.16],
  ];

  const VERT = `
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec3 offset;
    attribute vec3 color;
    uniform mat4 mvp;
    varying vec3 vColor;
    varying vec3 vNormal;
    void main() {
      vColor = color;
      vNormal = normal;
      gl_Position = mvp * vec4(position + offset, 1.0);
    }
  `;
  const FRAG = `
    precision mediump float;
    varying vec3 vColor;
    varying vec3 vNormal;
    void main() {
      float light = 0.38 + 0.62 * max(dot(normalize(vNormal), normalize(vec3(0.35, 1.0, 0.25))), 0.0);
      gl_FragColor = vec4(vColor * light, 1.0);
    }
  `;

  function cube() {
    const faces = [
      [0, 1, 0, [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1]],
      [0, -1, 0, [0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0]],
      [0, 0, 1, [0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1]],
      [0, 0, -1, [1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]],
      [1, 0, 0, [1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0]],
      [-1, 0, 0, [0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1]],
    ];
    const position = [];
    const normal = [];
    faces.forEach((face) => {
      for (let i = 0; i < 18; i += 3) {
        position.push(face[3][i] - 0.5, face[3][i + 1] - 0.5, face[3][i + 2] - 0.5);
        normal.push(face[0], face[1], face[2]);
      }
    });
    return { position, normal };
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[row] * b[col * 4] +
          a[4 + row] * b[col * 4 + 1] +
          a[8 + row] * b[col * 4 + 2] +
          a[12 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const range = near - far;
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / range, -1,
      0, 0, (2 * far * near) / range, 0,
    ]);
  }

  function lookAt(eye, target) {
    let fx = target[0] - eye[0];
    let fy = target[1] - eye[1];
    let fz = target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let sx = -fz;
    let sy = 0;
    let sz = fx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * fz - sz * fy;
    const uy = sz * fx - sx * fz;
    const uz = sx * fy - sy * fx;
    return new Float32Array([
      sx, ux, -fx, 0,
      sy, uy, -fy, 0,
      sz, uz, -fz, 0,
      -(sx * eye[0] + sy * eye[1] + sz * eye[2]),
      -(ux * eye[0] + uy * eye[1] + uz * eye[2]),
      fx * eye[0] + fy * eye[1] + fz * eye[2],
      1,
    ]);
  }

  function demo() {
    const blocks = [];
    for (let x = -7; x <= 7; x++) {
      for (let z = -7; z <= 7; z++) {
        blocks.push([x, -1, z, 1]);
        blocks.push([x, -2, z, 2]);
        blocks.push([x, -3, z, 3]);
        if (x * x + z * z < 5) blocks.push([x, 0, z, 15]);
      }
    }
    return { x: 0.5, y: 1, z: 0.5, yaw: 0.8, blocks, preview: true };
  }

  function mount(canvas, label) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) {
      label.textContent = "This browser cannot draw the terrain view.";
      return { show() {} };
    }
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    const shape = cube();
    const positions = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shape.position), gl.STATIC_DRAW);
    const normals = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normals);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shape.normal), gl.STATIC_DRAW);
    const offsets = gl.createBuffer();
    const colors = gl.createBuffer();
    const mvp = gl.getUniformLocation(program, "mvp");
    let count = 0;
    let scene = demo();
    let orbit = 0.7;
    let pitch = 0.85;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    function bindAttribute(buffer, name, size, divisor) {
      const location = gl.getAttribLocation(program, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      if (divisor) gl.vertexAttribDivisor(location, divisor);
    }

    function load(view) {
      const feetX = Math.floor(view.x);
      const feetY = Math.floor(view.y);
      const feetZ = Math.floor(view.z);
      const offset = [];
      const color = [];
      (view.blocks || []).forEach((block) => {
        const tint = COLORS[block[3]] || COLORS[3];
        offset.push(block[0] + 0.5, block[1] + 0.5, block[2] + 0.5);
        color.push(tint[0], tint[1], tint[2]);
      });
      offset.push(view.x - feetX, view.y - feetY + 0.9, view.z - feetZ);
      color.push(COLORS[0][0], COLORS[0][1], COLORS[0][2]);
      count = color.length / 3;
      gl.bindBuffer(gl.ARRAY_BUFFER, offsets);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(offset), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, colors);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(color), gl.DYNAMIC_DRAW);
      scene = view;
    }

    function frame() {
      const width = canvas.clientWidth || 640;
      const height = canvas.clientHeight || 420;
      const ratio = window.devicePixelRatio || 1;
      const pixelsW = Math.max(1, Math.floor(width * ratio));
      const pixelsH = Math.max(1, Math.floor(height * ratio));
      if (canvas.width !== pixelsW || canvas.height !== pixelsH) {
        canvas.width = pixelsW;
        canvas.height = pixelsH;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.11, 0.13, 0.16, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!count) return;
      const feetX = Math.floor(scene.x);
      const feetY = Math.floor(scene.y);
      const feetZ = Math.floor(scene.z);
      const focus = [scene.x - feetX, scene.y - feetY + 1.2, scene.z - feetZ];
      const heading = (scene.yaw || 0) + orbit;
      const distance = 16;
      const eye = [
        focus[0] - Math.sin(heading) * distance * Math.cos(pitch),
        focus[1] + Math.sin(pitch) * distance,
        focus[2] - Math.cos(heading) * distance * Math.cos(pitch),
      ];
      const view = lookAt(eye, focus);
      const projection = perspective(0.9, canvas.width / canvas.height, 0.1, 80);
      gl.useProgram(program);
      bindAttribute(positions, "position", 3, 0);
      bindAttribute(normals, "normal", 3, 0);
      bindAttribute(offsets, "offset", 3, 1);
      bindAttribute(colors, "color", 3, 1);
      gl.uniformMatrix4fv(mvp, false, multiply(projection, view));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, shape.position.length / 3, count);
    }

    canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointerup", () => { dragging = false; });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      orbit += (event.clientX - lastX) * 0.01;
      pitch = Math.max(0.15, Math.min(1.2, pitch + (event.clientY - lastY) * 0.008));
      lastX = event.clientX;
      lastY = event.clientY;
    });

    load(scene);
    label.textContent = "Preview terrain. The agent appears here after it joins the world. Drag to look around.";
    function show(view) {
      if (!view || !Array.isArray(view.blocks) || !view.blocks.length) return;
      load(view);
      label.textContent = `Agent at ${view.x}, ${view.y}, ${view.z}. Drag to look around.`;
    }
    function loop() {
      frame();
      requestAnimationFrame(loop);
    }
    loop();
    return { show };
  }

  const canvas = document.getElementById("terrain");
  const label = document.getElementById("view-pos");
  window.TerrainView = canvas && label ? mount(canvas, label) : { show() {} };
})();
