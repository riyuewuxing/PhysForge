import { z } from 'zod';

/**
 * 2025 修订版普通高中物理课程标准四大核心素养枚举
 */
export const CurriculumTagSchema = z.enum([
  '物理观念',
  '科学思维',
  '科学探究',
  '科学态度与责任'
]);

/**
 * 教学难度分级
 */
export const DifficultyLevelSchema = z.enum(['基础新授', '高三一轮', '压轴专题']);

/**
 * 人教版教材分册与课标元数据校验 Schema
 */
export const CurriculumMetaSchema = z.object({
  textbook: z.string().trim().min(1, '教材分册不能为空'),
  chapter: z.string().trim().min(1, '章节名称不能为空'),
  section: z.string().trim().min(1).optional(),
  curriculumTags: z.array(CurriculumTagSchema).min(1, '至少需标注一项核心素养'),
  difficulty: DifficultyLevelSchema,
  learningObjectives: z.array(z.string().trim().min(1)).min(1, '至少需包含一条教学目标')
});

/**
 * POE（Predict - Observe - Explain）课堂探究任务单 Schema
 */
export const PoeWorksheetSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  modelId: z.string().trim().min(1, 'POE 任务单必须绑定仿真 modelId'),
  presetId: z.string().trim().min(1, 'POE 任务单必须绑定仿真 presetId'),
  predictPrompt: z.string().trim().min(1, '预测阶段问题不能为空'),
  observeSteps: z.array(z.string().trim().min(1)).min(1, '观察操作步骤至少一条'),
  dataTableHeaders: z.array(z.string().trim().min(1)).optional(),
  explainPrompt: z.string().trim().min(1, '解释引导问题不能为空'),
  conclusionSummary: z.string().trim().min(1, '规律归纳结论不能为空')
});

/**
 * 物理校验元数据（防大模型算术幻觉）
 */
export const QuestionVerificationSchema = z.object({
  verified: z.boolean(),
  verifier: z.enum(['physics-core', 'sympy', 'manual']),
  tolerance: z.number().positive().optional(),
  expectedMetrics: z.record(z.string(), z.number().finite()),
  checkedAt: z.string().trim().min(1).optional()
});

/**
 * 高考母题与分层变式题 Schema
 */
export const VariantQuestionSchema = z.object({
  id: z.string().trim().min(1),
  tier: z.enum(['母题', '基础', '进阶', '压轴']),
  stem: z.string().trim().min(1, '题干不能为空'),
  options: z.array(z.string().trim().min(1)).min(2).optional(),
  answer: z.string().trim().min(1, '参考答案不能为空'),
  analysis: z.string().trim().min(1, '解析过程不能为空'),
  modelId: z.string().trim().min(1, '变式题必须绑定对应仿真 modelId'),
  presetId: z.string().trim().min(1, '变式题必须绑定对应仿真 presetId'),
  verification: QuestionVerificationSchema
});

/**
 * 前概念误区诊断卡（带反例仿真预设绑定）
 */
export const MisconceptionCardSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  misconception: z.string().trim().min(1, '常见错误直觉描述不能为空'),
  scientificConcept: z.string().trim().min(1, '科学物理图景纠正不能为空'),
  counterExampleModelId: z.string().trim().min(1, '必须绑定反例模型 ID'),
  counterExamplePresetId: z.string().trim().min(1, '必须绑定反例预设 ID'),
  diagnosticQuestion: z.string().trim().min(1).optional()
});

/**
 * 教研资源包总契约 Schema
 */
export const TeachingPackSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  version: z.string().trim().min(1),
  curriculum: CurriculumMetaSchema,
  poeWorksheets: z.array(PoeWorksheetSchema).min(1, '教研包至少需包含 1 份 POE 探究单'),
  variantQuestions: z.array(VariantQuestionSchema).min(1, '教研包至少需包含 1 道经校验变式题'),
  misconceptions: z.array(MisconceptionCardSchema).min(1, '教研包至少需包含 1 张前概念诊断卡')
});

export type CurriculumTag = z.infer<typeof CurriculumTagSchema>;
export type DifficultyLevel = z.infer<typeof DifficultyLevelSchema>;
export type CurriculumMeta = z.infer<typeof CurriculumMetaSchema>;
export type PoeWorksheet = z.infer<typeof PoeWorksheetSchema>;
export type QuestionVerification = z.infer<typeof QuestionVerificationSchema>;
export type VariantQuestion = z.infer<typeof VariantQuestionSchema>;
export type MisconceptionCard = z.infer<typeof MisconceptionCardSchema>;
export type TeachingPack = z.infer<typeof TeachingPackSchema>;

/**
 * 校验并解析教研包数据，不合法时抛出 ZodError
 */
export function parseTeachingPack(input: unknown): TeachingPack {
  return TeachingPackSchema.parse(input);
}
