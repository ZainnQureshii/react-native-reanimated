import type { ReactNode } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  SharedTransition,
  SharedTransitionBoundary,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  advanceAnimationTimer,
  describe,
  expect,
  expectEventually,
  getTestComponent,
  mockAnimationTimer,
  render,
  test,
  useTestRef,
  waitForFrames,
} from '../../../ReJest/RuntimeTestsApi';
import { ComparisonMode } from '../../../ReJest/types';
import { runOnUIBlocking } from '../../../ReJest/utils/runOnUIBlocking';

const androidTest = Platform.OS === 'android' ? test : test.skip;

function Endpoint({
  name,
  transition,
}: {
  name: 'source' | 'target' | 'candidate';
  transition: SharedTransition;
}) {
  const ref = useTestRef(`window-${name}`);
  return (
    <Animated.View
      ref={ref}
      sharedTransitionTag="layout-root"
      sharedTransitionStyle={transition}
      style={endpointStyles[name]}
    />
  );
}

function NativeRoot({
  dialog,
  children,
}: {
  dialog: boolean;
  children: ReactNode;
}) {
  return dialog ? (
    <Modal transparent animationType="none">
      <View style={styles.root}>{children}</View>
    </Modal>
  ) : (
    <View style={styles.root}>{children}</View>
  );
}

function Screens({
  active,
  sourceDialog,
  targetDialog,
  targetMounted = true,
  transition,
}: {
  active: boolean;
  sourceDialog: boolean;
  targetDialog: boolean;
  targetMounted?: boolean;
  transition: SharedTransition;
}) {
  return (
    <View style={styles.root}>
      <NativeRoot dialog={sourceDialog}>
        <SharedTransitionBoundary isActive={!active}>
          <Endpoint name="source" transition={transition} />
        </SharedTransitionBoundary>
        {sourceDialog && targetDialog && targetMounted && (
          <SharedTransitionBoundary isActive={active}>
            <Endpoint name="target" transition={transition} />
          </SharedTransitionBoundary>
        )}
      </NativeRoot>
      {(!sourceDialog || !targetDialog) && targetMounted && (
        <NativeRoot dialog={targetDialog}>
          <SharedTransitionBoundary isActive={active}>
            <Endpoint name="target" transition={transition} />
          </SharedTransitionBoundary>
        </NativeRoot>
      )}
    </View>
  );
}

function RetargetScreens({
  active,
  candidate,
  keepTarget,
  transition,
  candidateTransition,
}: {
  active: boolean;
  candidate: boolean;
  keepTarget: boolean;
  transition: SharedTransition;
  candidateTransition: SharedTransition;
}) {
  return (
    <View style={styles.root}>
      <SharedTransitionBoundary isActive={!active}>
        <Endpoint name="source" transition={transition} />
      </SharedTransitionBoundary>
      <SharedTransitionBoundary isActive={active}>
        {keepTarget && <Endpoint name="target" transition={transition} />}
        {candidate && (
          <Modal transparent animationType="none">
            <Endpoint name="candidate" transition={candidateTransition} />
          </Modal>
        )}
      </SharedTransitionBoundary>
    </View>
  );
}

describe('Shared transitions and Android layout roots', () => {
  androidTest.each([
    [false, true, false, ReduceMotion.Never],
    [true, false, false, ReduceMotion.Never],
    [true, true, false, ReduceMotion.Never],
    [false, true, true, ReduceMotion.Never],
    [false, true, false, ReduceMotion.Always],
  ] as const)(
    'refuses source dialog ${0}, target dialog ${1}, new target ${2}, motion ${3}',
    async ([sourceDialog, targetDialog, newTarget, motion]) => {
      await mockAnimationTimer({ autoAdvance: false });
      const results: boolean[] = [];
      const transition = recordingTransition(results).reduceMotion(motion);
      await render(
        <Screens
          active={false}
          sourceDialog={sourceDialog}
          targetDialog={targetDialog}
          targetMounted={!newTarget}
          transition={transition}
        />
      );
      await waitForFrames(3);
      if (!newTarget) await expectEndpoint('target', 150, 0.7);
      await render(
        <Screens
          active
          sourceDialog={sourceDialog}
          targetDialog={targetDialog}
          transition={transition}
        />
      );
      await waitForFrames();
      await expectEndpoint('source', 60, 0.6);
      await expectEndpoint('target', 150, 0.7);
      await expectEventually(() => results.length).toBe(1);
      expect(results).toBe([true]);
      await advanceAnimationTimer(1600);
      await expectEndpoint('source', 60, 0.6);
      await expectEndpoint('target', 150, 0.7);
      await render(
        <Screens
          active={false}
          sourceDialog={sourceDialog}
          targetDialog={targetDialog}
          transition={transition}
        />
      );
      await waitForFrames();
      await expectEndpoint('source', 60, 0.6);
      await expectEndpoint('target', 150, 0.7);
      await expectEventually(() => results.length).toBe(2);
      expect(results).toBe([true, true]);
    }
  );

  androidTest('keeps the surface-root transition enabled', async () => {
    await mockAnimationTimer({ autoAdvance: false });
    const results: boolean[] = [];
    const transition = recordingTransition(results);
    await render(
      <Screens
        active={false}
        sourceDialog={false}
        targetDialog={false}
        transition={transition}
      />
    );
    await waitForFrames(3);
    await render(
      <Screens
        active
        sourceDialog={false}
        targetDialog={false}
        transition={transition}
      />
    );
    await waitForFrames(3);
    await advanceAnimationTimer(400);
    const source =
      await getTestComponent('window-source').getMountedViewProps();
    const width = source?.width;
    expect(width !== undefined && width > 60 && width < 150).toBe(true);
    expect(results).toBe([]);
    await advanceAnimationTimer(1200);
    await expectEndpoint('target', 150, 0.7);
    await expectEventually(() => results.length).toBe(1);
    expect(results).toBe([true]);
  });

  androidTest.each([[true], [false]] as const)(
    'refuses an unsupported retarget (old target retained: ${0})',
    async ([keepTarget]) => {
      await mockAnimationTimer({ autoAdvance: false });
      const results: boolean[] = [];
      const candidateResults: boolean[] = [];
      const transition = recordingTransition(results);
      const candidateTransition = recordingTransition(candidateResults);
      await render(
        <RetargetScreens
          active={false}
          candidate={false}
          keepTarget
          transition={transition}
          candidateTransition={candidateTransition}
        />
      );
      await waitForFrames(3);
      const sourceTag = getTestComponent('window-source').getTag();
      await render(
        <RetargetScreens
          active
          candidate={false}
          keepTarget
          transition={transition}
          candidateTransition={candidateTransition}
        />
      );
      await waitForFrames(3);
      await advanceAnimationTimer(400);
      const widthBefore = await mountedWidth(sourceTag);
      expect(
        widthBefore !== undefined && widthBefore > 60 && widthBefore < 150
      ).toBe(true);
      await render(
        <RetargetScreens
          active
          candidate
          keepTarget={keepTarget}
          transition={transition}
          candidateTransition={candidateTransition}
        />
      );
      await waitForFrames();
      await expectEndpoint('candidate', 210, 0.8);
      expect(await mountedWidth(sourceTag)).toBe(
        widthBefore,
        ComparisonMode.PIXEL
      );
      expect(results).toBe([]);
      expect(candidateResults).toBe([]);
      await advanceAnimationTimer(400);
      const widthAfter = await mountedWidth(sourceTag);
      expect(
        widthAfter !== undefined &&
          widthAfter > (widthBefore ?? 0) &&
          widthAfter < 150
      ).toBe(true);
      await advanceAnimationTimer(1200);
      await expectEventually(() => results.length).toBe(1);
      expect(results).toBe([true]);
      expect(candidateResults).toBe([]);
      await expectEndpoint('candidate', 210, 0.8);
      if (keepTarget) await expectEndpoint('target', 150, 0.7);
      else await expectEndpoint('source', 60, 0.6);
    }
  );
});

function recordingTransition(results: boolean[]) {
  const record = (finished: boolean) => results.push(finished);
  return SharedTransition.duration(1200)
    .easing(Easing.linear)
    .reduceMotion(ReduceMotion.Never)
    .withCallback((finished) => {
      'worklet';
      scheduleOnRN(record, finished);
    });
}

async function expectEndpoint(
  name: 'source' | 'target' | 'candidate',
  width: number,
  opacity: number
) {
  const props = await getTestComponent(`window-${name}`).getMountedViewProps();
  expect(props?.width).toBe(width, ComparisonMode.PIXEL);
  expect(props?.opacity).toBe(opacity, ComparisonMode.FLOAT_DISTANCE);
}

function mountedWidth(tag: number) {
  return runOnUIBlocking(() => {
    'worklet';
    return global._obtainMountedViewProps(tag, false)?.width;
  });
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  source: { width: 60, height: 60, opacity: 0.6, backgroundColor: '#dd5522' },
  target: {
    marginTop: 200,
    width: 150,
    height: 150,
    opacity: 0.7,
    backgroundColor: '#2277dd',
  },
  candidate: {
    marginTop: 300,
    width: 210,
    height: 210,
    opacity: 0.8,
    backgroundColor: '#22bb77',
  },
});

const endpointStyles = {
  source: styles.source,
  target: styles.target,
  candidate: styles.candidate,
};
