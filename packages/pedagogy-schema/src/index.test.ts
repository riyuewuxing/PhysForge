import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  CurriculumMetaSchema,
  MisconceptionCardSchema,
  PoeWorksheetSchema,
  TeachingPackSchema,
  VariantQuestionSchema,
  parseTeachingPack
} from './index.js';

const validTeachingPack = {
  id: 'pack-em-bounded-field-01',
  title: '带电粒子在有界匀强磁场中的临界问题',
  version: '1.0.0',
  curriculum: {
    textbook: '人教版 选择性必修二',
    chapter: '第一章 安培力与洛伦兹力',
    section: '第3节 带电粒子在匀强磁场中的运动',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '压轴专题',
    learningObjectives: ['掌握放缩圆与旋转圆确定临界轨道圆心的方法']
  },
  poeWorksheets: [
    {
      id: 'poe-focus-01',
      title: '圆形匀强磁场磁聚焦探究单',
      modelId: 'em-bounded-magnetic-field',
      presetId: 'magnetic-focus-parallel',
      predictPrompt: '一束平行同种带电粒子射入满足 R = r_field 的圆形磁场，出射方向如何？',
      observeSteps: ['打开 POE 遮罩前口头作图', '取消遮罩并运行仿真至粒子全数穿出'],
      dataTableHeaders: ['入射偏距 y', '出射点位置'],
      explainPrompt: '利用几何菱形关系证明为何所有粒子会汇聚到同一点？',
      conclusionSummary: '当回旋半径等于圆形磁场半径时，平行入射粒子精确汇聚于同一边界点。'
    }
  ],
  variantQuestions: [
    {
      id: 'q-var-base-01',
      tier: '基础',
      stem: '质量为 m、电荷量为 q 的粒子以速度 v 垂直射入磁感应强度为 B 的磁场，求轨道半径 R。',
      options: ['mv/(qB)', 'qB/(mv)', 'mv^2/(qB)', 'qBv/m'],
      answer: 'A',
      analysis: '由洛伦兹力提供向心力 qvB = mv^2 / R 得 R = mv / (qB)。',
      modelId: 'em-bounded-magnetic-field',
      presetId: 'circular-orbit-basic',
      verification: {
        verified: true,
        verifier: 'physics-core',
        tolerance: 1e-5,
        expectedMetrics: { radius: 0.5, period: 3.14159265 }
      }
    }
  ],
  misconceptions: [
    {
      id: 'mis-lorentz-work',
      title: '误以为洛伦兹力可以对运动电荷做正功',
      misconception: '粒子速度方向改变且受到洛伦兹力，因此洛伦兹力对粒子做功改变动能。',
      scientificConcept: '洛伦兹力始终与速度垂直，瞬时功率 F·v ≡ 0，永不做功，只改变速度方向。',
      counterExampleModelId: 'em-bounded-magnetic-field',
      counterExamplePresetId: 'pure-b-kinetic-invariant',
      diagnosticQuestion: '观察动能示波器曲线在纯磁场中是否保持水平直线？'
    }
  ]
};

describe('pedagogy-schema', () => {
  it('accepts a valid complete teaching pack', () => {
    const parsed = parseTeachingPack(validTeachingPack);
    expect(parsed.id).toBe('pack-em-bounded-field-01');
    expect(parsed.poeWorksheets).toHaveLength(1);
    expect(parsed.variantQuestions[0]?.verification.verified).toBe(true);
  });

  it('rejects missing modelId or presetId bindings on POE worksheet and variants', () => {
    const missingPreset = {
      ...validTeachingPack.poeWorksheets[0],
      presetId: '   '
    };
    expect(() => PoeWorksheetSchema.parse(missingPreset)).toThrow(ZodError);

    const missingModel = {
      ...validTeachingPack.variantQuestions[0],
      modelId: ''
    };
    expect(() => VariantQuestionSchema.parse(missingModel)).toThrow(ZodError);
  });

  it('rejects invalid curriculum tags, empty misconceptions, and non-finite verification metrics', () => {
    expect(() =>
      CurriculumMetaSchema.parse({
        ...validTeachingPack.curriculum,
        curriculumTags: ['解题技巧']
      })
    ).toThrow(ZodError);

    expect(() =>
      MisconceptionCardSchema.parse({
        ...validTeachingPack.misconceptions[0],
        counterExamplePresetId: ''
      })
    ).toThrow(ZodError);

    expect(() =>
      TeachingPackSchema.parse({
        ...validTeachingPack,
        variantQuestions: [
          {
            ...validTeachingPack.variantQuestions[0],
            verification: {
              verified: true,
              verifier: 'physics-core',
              expectedMetrics: { radius: Number.NaN }
            }
          }
        ]
      })
    ).toThrow(ZodError);
  });
});
