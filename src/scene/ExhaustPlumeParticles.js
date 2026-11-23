// Pooled visual effect with heuristic drag and buoyancy; not CFD or a curl-noise solver.
import * as THREE from 'three';

export class ExhaustPlumeParticles {
  constructor(scene, { maxParticles = 900, triggerAltitude = 15.0 } = {}) {
    if (!Number.isInteger(maxParticles) || maxParticles < 1 || !Number.isFinite(triggerAltitude) || triggerAltitude <= 0)
      throw new Error('Invalid particle pool or trigger altitude');
    this.nextSlot = 0;
    this.scene = scene;
    this.maxParticles = maxParticles;
    this.triggerAltitude = triggerAltitude;
    this.spawnAccumulator = 0;

    // 파티클 상태 버퍼 (가비지 컬렉션 방지를 위한 TypedArray 풀)
    this.positions = new Float32Array(maxParticles * 3);
    this.velocities = new Float32Array(maxParticles * 3);
    this.ages = new Float32Array(maxParticles);
    this.lifetimes = new Float32Array(maxParticles);
    this.baseSizes = new Float32Array(maxParticles);
    this.sizes = new Float32Array(maxParticles);
    this.alphas = new Float32Array(maxParticles);
    this.active = new Uint8Array(maxParticles);

    this._initPoints();
  }

  // 오프스크린 캔버스로 부드러운 연기 텍스처 생성
  _createSmokeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error('Canvas 2D is unavailable');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0.0, 'rgba(241, 245, 249, 0.85)');
    grad.addColorStop(0.4, 'rgba(203, 213, 225, 0.45)');
    grad.addColorStop(0.75, 'rgba(148, 163, 184, 0.15)');
    grad.addColorStop(1.0, 'rgba(148, 163, 184, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  _initPoints() {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));

    // 파티클별 개별 크기와 투명도를 지원하는 경량 셰이더
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPointScale: { value: 340 },
        uTexture: { value: this._createSmokeTexture() },
        uColor: { value: new THREE.Color(0xdbeafe) } // 야간 조명을 받은 밝은 회백색 배기 연기
      },
      vertexShader: `
        uniform float uPointScale;
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;

        void main() {
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (uPointScale / max(1.0, -mvPosition.z));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform vec3 uColor;
        varying float vAlpha;

        void main() {
          vec4 texColor = texture2D(uTexture, gl_PointCoord);
          float finalAlpha = texColor.a * vAlpha;
          if (finalAlpha < 0.01) discard;
          // Stylized cool rim lighting, not physical scattering/CFD.
          float rim = smoothstep(0.05, 0.45, length(gl_PointCoord - vec2(0.5)));
          vec3 litColor = mix(uColor * 0.55, vec3(0.48, 0.78, 1.0), rim * 0.65);
          gl_FragColor = vec4(litColor, finalAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    for (const attr of Object.values(this.geometry.attributes)) attr.setUsage(THREE.DynamicDrawUsage);
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  // 시뮬레이션 리셋 시 모든 파티클 즉시 비활성화
  reset() {
    this.nextSlot = 0;
    this.spawnAccumulator = 0;
    for (let i = 0; i < this.maxParticles; i++) {
      this.active[i] = 0;
      this.alphas[i] = 0;
      this.sizes[i] = 0;
    }
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }

  // 비활성 슬롯을 찾아 새 연기 파티클 1개 방출
  _spawnParticle(impactX, intensity, impactZ = 0) {
    for (let offset = 0; offset < this.maxParticles; offset++) {
      const i = (this.nextSlot+offset)%this.maxParticles;
      if (this.active[i] === 0) {
        this.active[i] = 1;
        this.ages[i] = 0;
        this.lifetimes[i] = 1.2 + Math.random() * 1.2; // 0.9 ~ 2.0초 생존

        // 지면 충돌 지점 주변에서 생성
        const jitterR = Math.random() * 0.8;
        const spawnAngle = Math.random() * Math.PI * 2;
        const idx = i * 3;
        this.positions[idx] = impactX + Math.cos(spawnAngle) * jitterR;
        this.positions[idx + 1] = 0.25 + Math.random() * 0.2;
        this.positions[idx + 2] = impactZ + Math.sin(spawnAngle) * jitterR;

        // 방사형 외곽 분출 속도 (추력과 지면 근접도에 비례)
        const radialAngle = Math.random() * Math.PI * 2;
        const radialSpeed = (7.0 + Math.random() * 13.0) * (0.35 + 0.65 * intensity);
        this.velocities[idx] = Math.cos(radialAngle) * radialSpeed;
        this.velocities[idx + 1] = (0.6 + Math.random() * 1.6) * intensity;
        this.velocities[idx + 2] = Math.sin(radialAngle) * radialSpeed;

        this.baseSizes[i] = (2.0 + Math.random() * 1.8) * (0.6 + 0.4 * intensity);
        this.sizes[i] = this.baseSizes[i];
        this.alphas[i] = 0.0;
        this.nextSlot = (i+1)%this.maxParticles;
        return;
      }
    }
  }

  // 매 렌더 프레임 호출
  update(simState, deltaTime, nozzlePosition = null) {
    if (!simState || !Number.isFinite(deltaTime) || deltaTime <= 0) return;
    // Visual timestep only. Does not feed force or damage back into the sim.
    deltaTime = Math.min(deltaTime, .05);
    const {x,y,theta,gimbalRad,thrustRatio,status} = simState;
    const originX = nozzlePosition?.x ?? x;
    const originY = nozzlePosition?.y ?? y;
    const originZ = nozzlePosition?.z ?? 0;
    const angle = theta+gimbalRad;
    const down = Math.cos(angle);
    if (!simState.done && status === 'FLYING' && simState.thrust > 0 &&
        originY >= 0 && originY < this.triggerAltitude && down > .1 &&
        Number.isFinite(originX+originY+originZ+angle+thrustRatio)) {
      const intensity = Math.max(0,Math.min(1,(1-originY/this.triggerAltitude)*thrustRatio));
      const impactX = originX+originY*Math.sin(angle)/down;
      this.spawnAccumulator += 340*intensity*deltaTime;
      while (this.spawnAccumulator >= 1) {
        this._spawnParticle(impactX,intensity,originZ);
        this.spawnAccumulator--;
      }
    } else this.spawnAccumulator = 0;

    // 2. 활성 파티클 물리 이동, 팽창, 소멸 업데이트
    let needsUpdate = false;
    const dragFactor = Math.exp(-2.4 * deltaTime);

    for (let offset = 0; offset < this.maxParticles; offset++) {
      const i = (this.nextSlot+offset)%this.maxParticles;
      if (this.active[i] === 0) continue;

      needsUpdate = true;
      this.ages[i] += deltaTime;

      if (this.ages[i] >= this.lifetimes[i]) {
        this.active[i] = 0;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }

      const lifeRatio = this.ages[i] / this.lifetimes[i];
      const idx = i * 3;

      // 위치 적분
      this.positions[idx] += this.velocities[idx] * deltaTime;
      this.positions[idx + 1] += this.velocities[idx + 1] * deltaTime;
      this.positions[idx + 2] += this.velocities[idx + 2] * deltaTime;

      // 수평 공기 저항 감속 + 열기 상승 부력
      this.velocities[idx] *= dragFactor;
      this.velocities[idx + 2] *= dragFactor;
      this.velocities[idx + 1] += 2.2 * deltaTime;

      // 지면 아래로 파고들지 않도록 바닥 클램핑
      if (this.positions[idx + 1] < 0.2) {
        this.positions[idx + 1] = 0.2;
      }

      // 연기 구름 팽창 (시간이 지날수록 최대 3.5배 확산)
      this.sizes[i] = this.baseSizes[i] * (1.0 + lifeRatio * 3.0);

      // 부드러운 페이드 인(초반 12%) 및 페이드 아웃
      if (lifeRatio < 0.12) {
        this.alphas[i] = (lifeRatio / 0.12) * 0.55;
      } else {
        this.alphas[i] = (1.0 - (lifeRatio - 0.12) / 0.88) * 0.55;
      }
    }

    if (needsUpdate) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
    }
  }
  setViewport(camera, drawingBufferHeight) {
    this.material.uniforms.uPointScale.value = drawingBufferHeight * camera.projectionMatrix.elements[5] / 2;
  }

  dispose() {
    this.scene.remove(this.points);
    this.material.uniforms.uTexture.value.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}