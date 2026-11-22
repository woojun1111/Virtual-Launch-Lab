// Requires three. Visuals only: grid fins and altitude-triggered legs do not apply forces.
import * as THREE from 'three';

export class RocketVisual {
  constructor(rocketLength = 10.0) {
    if (!Number.isFinite(rocketLength) || rocketLength <= 0) throw new Error('Invalid rocket length');
    this.rocketLength = rocketLength;
    this._lastTime = null;
    this.rootGroup = new THREE.Group(); // 전체 로켓 루트 (위치 및 자세 제어용)
    this.legs = [];

    this._buildBody();
    this._buildGridFins();
    this._buildLandingLegs();
    this._buildNozzleAndFlame();
  }

  // 1. 로켓 메인 동체 및 노즈콘 (팰컨 9 스타일)
  _buildBody() {
    const radius = 0.65;
    const bodyHeight = this.rocketLength * 0.85;

    // 동체 (원기둥) - 피벗(원점 0,0,0)이 로켓의 무게중심(중앙)에 오도록 배치
    const bodyGeo = new THREE.CylinderGeometry(radius, radius, bodyHeight, 24);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.35,
      metalness: 0.2
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.position.y = -this.rocketLength * 0.075;
    this.rootGroup.add(bodyMesh);

    // 상단 인터스테이지 (검은색 탄소섬유 영역)
    const interstageHeight = this.rocketLength * 0.15;
    const interGeo = new THREE.CylinderGeometry(radius * 1.01, radius * 1.01, interstageHeight, 24);
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.6,
      metalness: 0.4
    });
    const interMesh = new THREE.Mesh(interGeo, darkMat);
    interMesh.position.y = this.rocketLength / 2 - interstageHeight / 2;
    this.rootGroup.add(interMesh);
  }

  // 2. 상단 티타늄 그리드 핀 4개
  _buildGridFins() {
    const material = new THREE.MeshStandardMaterial({color: 0x64748b, metalness: .8, roughness: .3});
    this.gridFins = [];
    for (let i = 0; i < 4; i++) {
      const mount = new THREE.Group();
      const angle = i * Math.PI / 2;
      mount.position.set(Math.cos(angle)*.65, this.rocketLength*.38, Math.sin(angle)*.65);
      mount.rotation.y = -angle;
      const lattice = new THREE.Group();
      for (let j = 0; j <= 5; j++) {
        const radial = new THREE.Mesh(new THREE.BoxGeometry(1, .045, .045), material);
        radial.position.set(.5, 0, -.4+j*.16);
        const cross = new THREE.Mesh(new THREE.BoxGeometry(.045, .045, .8), material);
        cross.position.x = j*.2;
        lattice.add(radial, cross);
      }
      mount.add(lattice);
      this.rootGroup.add(mount);
      this.gridFins.push(lattice);
    }
  }

  // 3. 전개식 착륙 다리 4개 (고도 낮아질 때 펼쳐짐)
  _buildLandingLegs() {
    const legLength = 2.6;
    const legGeo = new THREE.BoxGeometry(0.14, legLength, 0.22);
    // 다리의 상단 힌지가 회전축이 되도록 지오메트리 중심 이동
    legGeo.translate(0, -legLength / 2, 0);

    const legMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
    const bottomY = -this.rocketLength * 0.4;

    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      pivot.position.set(Math.cos(angle) * 0.65, bottomY, Math.sin(angle) * 0.65);
      pivot.rotation.y = -angle;

      const legMesh = new THREE.Mesh(legGeo, legMat);
      // 초기 상태: 동체에 접혀 있음 (위쪽을 향하도록 회전)
      legMesh.rotation.z = Math.PI * 0.95;
      pivot.add(legMesh);

      this.rootGroup.add(pivot);
      this.legs.push(legMesh);
    }
  }

  // 4. 추력 벡터 제어(TVC) 짐벌 노즐 및 이중 배기가스 화염
  _buildNozzleAndFlame() {
    // 노즐 회전 피벗 (로켓 최하단)
    this.nozzlePivot = new THREE.Group();
    this.nozzlePivot.position.y = -this.rocketLength * 0.43;
    this.rootGroup.add(this.nozzlePivot);

    // 엔진 노즐 벨 (원뿔형)
    const nozzleGeo = new THREE.ConeGeometry(0.45, 0.8, 20, 1, true);
    nozzleGeo.translate(0, -0.4, 0);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.85,
      roughness: 0.25,
      side: THREE.DoubleSide
    });
    const nozzleMesh = new THREE.Mesh(nozzleGeo, nozzleMat);
    this.nozzlePivot.add(nozzleMesh);

    // 화염 컨테이너 (노즐 출구 바로 아래)
    this.flameGroup = new THREE.Group();
    this.flameGroup.position.y = -0.8;
    this.nozzlePivot.add(this.flameGroup);

    // 외부 오렌지색 플룸
    const outerFlameGeo = new THREE.ConeGeometry(0.55, 4.0, 16);
    outerFlameGeo.rotateX(Math.PI); // 아래쪽을 향하도록 뒤집기
    outerFlameGeo.translate(0, -2.0, 0);
    const outerFlameMat = new THREE.MeshBasicMaterial({
      color: 0xff6b00,
      transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
      opacity: 0.75
    });
    this.outerFlame = new THREE.Mesh(outerFlameGeo, outerFlameMat);
    this.flameGroup.add(this.outerFlame);

    // 내부 백열 코어 플룸
    const innerFlameGeo = new THREE.ConeGeometry(0.28, 2.2, 16);
    innerFlameGeo.rotateX(Math.PI);
    innerFlameGeo.translate(0, -1.1, 0);
    const innerFlameMat = new THREE.MeshBasicMaterial({
      color: 0xfffbeb,
      transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
      opacity: 0.95
    });
    this.innerFlame = new THREE.Mesh(innerFlameGeo, innerFlameMat);
    this.flameGroup.add(this.innerFlame);

    // 엔진 점화 시 지면을 비추는 포인트 라이트
    this.plumeLight = new THREE.PointLight(0xff8800, 0, 35);
    this.plumeLight.position.y = -1.5;
    this.flameGroup.add(this.plumeLight);
  }

  // 매 프레임 시뮬레이션 상태를 3D 메쉬에 반영
  updateVisuals(simState, timeElapsed) {
    const { x, y, theta, gimbalRad, thrustRatio, status } = simState;
    const dt = this._lastTime === null ? 0 : Math.max(0, Math.min(.1, timeElapsed-this._lastTime));
    this._lastTime = timeElapsed;

    // Visual-only ground clearance: the Python model uses point contact at y=0.
    // This offset does not change dynamics or add a rigid-body contact model.
    this.rootGroup.position.set(x, y + this.rocketLength * 0.4 + 2.6 * Math.cos(Math.PI*.25), 0);
    this.rootGroup.rotation.z = theta;

    // 2. 짐벌 노즐 회전 업데이트
    this.nozzlePivot.rotation.z = gimbalRad;

    // 3. 추력 화염 스케일 및 고주파 플리커(떨림) 애니메이션
    if (!simState.done && status === 'FLYING' && simState.thrust > 0 && thrustRatio > 0.01) {
      this.flameGroup.visible = true;
      const flicker = 0.92 + Math.sin(timeElapsed * 65.0) * (1-Math.exp(-5*dt));
      const flameScaleY = thrustRatio * 1.4 * flicker;
      const flameScaleXZ = 0.8 + thrustRatio * 0.4;

      this.flameGroup.scale.set(flameScaleXZ, flameScaleY, flameScaleXZ);
      this.outerFlame.material.opacity = .3 + .45*thrustRatio;
      this.innerFlame.material.opacity = .6 + .35*thrustRatio;
      this.plumeLight.intensity = thrustRatio * 8.0 * flicker;
    } else {
      this.flameGroup.visible = false;
      this.plumeLight.intensity = 0;
    }

    // 4. 착륙 다리 전개 애니메이션 (고도 25m 이하에서 서서히 전개)
    const targetLegAngle = y < 25.0 ? Math.PI * 0.25 : Math.PI * 0.95;
    for (const leg of this.legs) {
      leg.rotation.z += (targetLegAngle - leg.rotation.z) * (1-Math.exp(-5*dt));
    }
  }
  resetVisuals() {
    this._lastTime = null;
    for (const leg of this.legs) leg.rotation.z = Math.PI*.95;
    this.flameGroup.visible = false;
    this.plumeLight.intensity = 0;
  }

  dispose() {
    const geometries = new Set(), materials = new Set();
    this.rootGroup.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
    });
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    this.rootGroup.removeFromParent();
  }
}