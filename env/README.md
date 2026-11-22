# Synthetic 2D landing environment

요청된 기본 역학 과제의 Gymnasium 구현입니다. 특정 발사체의 제원, 회수 유도,
제어기, 학습 정책은 포함하지 않습니다. 웹 UI와는 연결하지 않았습니다.

저장소 루트에서:

```sh
python -m pip install -r env/requirements.txt
python -m unittest discover -s tests -p test_rocket_landing_env.py -v
```

```python
from env.rocket_landing_env import RocketLandingEnv

env = RocketLandingEnv()
obs, info = env.reset(seed=42)
env.action_space.seed(42)
while True:
    obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
    if terminated or truncated:
        print(info['outcome'], info['is_success'])
        break
```

상태: [x, y, vx, vy, theta, omega, fuel_mass], float32 사본.
내부 계산: float64, 명시적 Euler dt=0.05 s. 위치/각도는 스텝 시작 속도/
각속도로 갱신합니다. g=9.81 m/s². theta=0은 위쪽, 양의 각도는 반시계입니다.

행동 첫 성분은 [-1,1] → [0.4,1.0] 추력비, 두 번째는 [-15°,15°] 짐벌각입니다.
범위 밖이나 비유한 행동은 오류로 처리합니다. 최대 추력 30 N, 건조질량 1 kg,
초기 연료 .5 kg, 최대 질량유량 .08 kg/s, 길이 1 m, 너비 .1 m는 가상 기본값입니다.
생성자 인자로 변경할 수 있습니다. 연료 소모는 매핑된 추력비에 비례합니다.
연료가 스텝 도중 소진되면 그 스텝의 평균 출력만 남은 연료 비율로 감소시킵니다.
연소 종료 이벤트를 정확하게 적분하는 방식이 아닙니다.

관성은 고정 형상의 균질 직사각형 근사입니다. 엔진 작용점은 중심 아래쪽에
있으며 힘의 작용점에서 회전 모멘트를 계산합니다. 실제 연료 배치, 질량중심 이동,
배출 유동의 회전 운동량, 대기, 충돌 강체 솔버는 모델링하지 않습니다.

접지는 스텝 종료 시 판정하고 y만 0으로 고정합니다. vx, vy, theta, omega는
접지 판정값을 보존합니다. info.impact_state는 상태 사본입니다. 충격량/구조 파손을
계산하는 것이 아니고 접지 시각의 보간이나 충돌 후 반발도 없습니다.

보상은 갱신된 상태의 거리·속력·기울기와 요청된 **매핑 후** 추력비를 사용합니다.
연료가 고갈되어 출력이 0이어도 요청 추력비 비용은 남습니다. 접지 시 거리는 y=0
기준입니다. 성공 +200/추락·경계이탈 -100은 dense reward에 더합니다.
요청된 성공 기준에는 수평속도/각속도 제한이 없으며 임의로 추가하지 않았습니다.
연료가 남아 있으면 엔진을 끌 수 없습니다. 이것들은 과제 사양이지 실물 안전 기준이 아닙니다.

기본 경계: abs(x)>=100 m 또는 y>=200 m. 기본 시간 제한은 1,000스텝입니다.
접지/경계 이탈은 terminated, 시간 제한만 도달하면 truncated입니다.
둘이 동시에 발생하면 terminated가 우선합니다. 완료 후에는 reset이 필요합니다.
reset(options={'initial_state': [...]})로 시험 조건을 지정할 수 있습니다.
지면 위, 경계 안에서 시작해야 합니다. 렌더링은 지원하지 않습니다.

검증: Gymnasium check_env와 unittest 10개 통과. 관측 공간의 위치/속도 범위를
무한대로 선언했으므로 check_env의 무한 범위 권고 경고가 출력될 수 있습니다.
범위를 넘긴 종료 상태도 유효한 관측으로 반환하기 위한 선언이며 NaN/inf 상태는 거부합니다.
