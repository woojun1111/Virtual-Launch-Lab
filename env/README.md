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

## PPO 학습과 1회 평가

저장소 루트에서:

```sh
python -m pip install -r requirements-rl.txt
python train_rl.py
python evaluate_rl.py
```

학습은 기본 500,000 timesteps, 단일 DummyVecEnv, 관측/보상 VecNormalize를 사용합니다.
rollout 크기를 2,000으로 두어 기본 실행이 500,000스텝을 넘지 않도록 했습니다.
50,000스텝마다 models/ppo_landing_50000_steps.zip 형태의 모델과
models/ppo_landing_vecnormalize_50000_steps.pkl 형태의 통계를 함께 저장합니다.
최종 파일은 models/ppo_landing_final.zip, models/vec_normalize.pkl입니다.
Monitor는 정규화 안쪽에서 원래 에피소드 return을 기록합니다.
training_curve.png는 에피소드 누적 보상과 최대 50개 에피소드 이동평균입니다.

평가는 같은 환경 기본값과 저장된 정규화 통계를 로드하며 training=False,
norm_reward=False, deterministic=True로 한 에피소드만 실행합니다.
trajectory_log.json은 초기 상태와 매 스텝 종료 상태의 배열이며,
t(s), x/y(m), vx/vy(m/s), theta(rad), thrust(N), gimbal(rad)을 기록합니다.
thrust/gimbal은 해당 행 직전 구간에 적용된 값입니다. 초기 행의 출력 0은 아직
행동이 적용되지 않았다는 뜻입니다. 추가 필드 force_theta는 해당 구간 시작 자세와
짐벌의 합으로, 적분 후 자세와 혼동하지 않고 힘의 화살표를 그리는 데 사용합니다.
자동 초기화 이전의 원래 종료 상태를 별도 보존하므로 최종 접지 값이 손실되지 않습니다.
trajectory_plot.png에는 궤적/추력 벡터와 추력 시간 그래프가 저장됩니다.
화살표 길이는 표시용 공통 배율이며 실제 기하 변위가 아닙니다.

다른 모델을 평가할 때는 반드시 동일 스텝의 정규화 통계를 선택합니다.

```sh
python evaluate_rl.py --model models/ppo_landing_50000_steps.zip --vec-normalize models/ppo_landing_vecnormalize_50000_steps.pkl --output checkpoint_50000.json --plot checkpoint_50000.png
```

기존 결과를 덮어쓰지 않도록 비어 있지 않은 models-dir과 기존 출력 파일은 거부합니다.
새 실행은 --models-dir models/run2 --curve-path training_curve_run2.png 등으로 구분하세요.
학습 중단/재개 기능은 이번 스크립트에 포함하지 않습니다.

검증: 512스텝의 짧은 PPO 학습을 실제 실행해 128/256/384/512스텝 체크포인트와
각 정규화 통계, 최종 모델 및 곡선 생성을 확인했습니다. 이를 로드한 평가 에피소드는
69스텝 후 crashed로 끝났고 초기 상태를 포함한 70개 JSON 행과 그래프가 생성됐습니다.
이는 코드 연결 검증이며 학습 성공이나 회수 성능의 증거가 아닙니다.
500,000스텝 본학습은 실행하지 않았습니다. Python 테스트 11개는 환경 API와
평가 시 정규화 동결/종료 상태 보존을 검사합니다.
