export const BRANCHES = {
  EMPLOYEE: 'employee',
  COMPANY: 'company'
};

export const STEPS = {
  ACCOUNT: 'account',
  PROFILE: 'profile',
  EMPLOYEE: 'employee',
  COMPANY: 'company',
  REVIEW: 'review'
};

export const COMMON_STEPS = [STEPS.ACCOUNT, STEPS.PROFILE];
export const BRANCH_STEPS = {
  [BRANCHES.EMPLOYEE]: STEPS.EMPLOYEE,
  [BRANCHES.COMPANY]: STEPS.COMPANY
};

export const initialValues = {
  accountType: BRANCHES.EMPLOYEE,
  username: '',
  email: '',
  country: 'CN',
  fullName: '',
  postalCode: '',
  employeeId: '',
  monthlySalary: '',
  benefitCoverage: '',
  companyName: '',
  taxId: '',
  registrationProof: '',
  agree: false
};

const option = (value, label) => ({ value, label });

export const stepConfig = [
  {
    id: STEPS.ACCOUNT,
    title: '账户类型',
    description: '选择个人雇员或企业账户。后续字段会进入不同分支，两个分支的草稿始终独立保留。',
    fields: ['accountType', 'username', 'email']
  },
  {
    id: STEPS.PROFILE,
    title: '基础资料',
    description: '通用信息会在分支合并时进入最终提交；邮编规则依赖国家字段。',
    fields: ['country', 'fullName', 'postalCode']
  },
  {
    id: STEPS.EMPLOYEE,
    branch: BRANCHES.EMPLOYEE,
    title: '雇员信息',
    description: '雇员分支包含工号、薪资和福利额度。福利额度依赖薪资进行联动校验。',
    fields: ['employeeId', 'monthlySalary', 'benefitCoverage']
  },
  {
    id: STEPS.COMPANY,
    branch: BRANCHES.COMPANY,
    title: '企业信息',
    description: '企业分支包含名称、税号和登记凭证。税号规则依赖基础资料中的国家。',
    fields: ['companyName', 'taxId', 'registrationProof']
  },
  {
    id: STEPS.REVIEW,
    title: '确认提交',
    description: '这里展示通用字段与当前分支的合并结果；另一个分支的数据仍保留在草稿中。',
    fields: ['agree']
  }
];

export const fieldConfig = {
  accountType: {
    label: '账户类型',
    type: 'select',
    options: [
      option(BRANCHES.EMPLOYEE, '个人 / 雇员'),
      option(BRANCHES.COMPANY, '企业')
    ]
  },
  username: {
    label: '用户名',
    type: 'text',
    placeholder: '至少 4 个字符，试试 admin 或 taken',
    autocomplete: 'username'
  },
  email: {
    label: '邮箱',
    type: 'email',
    placeholder: 'name@example.com',
    autocomplete: 'email'
  },
  country: {
    label: '国家 / 地区',
    type: 'select',
    options: [option('CN', '中国大陆'), option('US', '美国'), option('SG', '新加坡')]
  },
  fullName: {
    label: '姓名',
    type: 'text',
    placeholder: '与证件一致'
  },
  postalCode: {
    label: '邮政编码',
    type: 'text',
    placeholder: '依赖国家进行格式校验'
  },
  employeeId: {
    label: '工号',
    type: 'text',
    placeholder: 'EMP-12345'
  },
  monthlySalary: {
    label: '月薪（元）',
    type: 'number',
    placeholder: '例如 20000'
  },
  benefitCoverage: {
    label: '月度福利额度（元）',
    type: 'number',
    placeholder: '不能高于月薪'
  },
  companyName: {
    label: '企业名称',
    type: 'text',
    placeholder: '例如 上海示例科技有限公司'
  },
  taxId: {
    label: '统一社会信用代码 / 企业税号',
    type: 'text',
    placeholder: '18 位，末尾可用 X'
  },
  registrationProof: {
    label: '登记凭证编号',
    type: 'text',
    placeholder: '异步核验，输入 invalid 会失败'
  },
  agree: {
    label: '我确认合并后的信息真实、完整，并同意提交。',
    type: 'checkbox'
  }
};

export function getStep(stepId) {
  return stepConfig.find((step) => step.id === stepId);
}

export function visibleSteps(branch) {
  return [
    ...COMMON_STEPS,
    BRANCH_STEPS[branch],
    STEPS.REVIEW
  ];
}

export function stepIndex(stepId, branch) {
  return visibleSteps(branch).indexOf(stepId);
}

export function fieldsForStep(stepId) {
  return getStep(stepId)?.fields ?? [];
}

export function branchFields(branch) {
  const branchStep = stepConfig.find((step) => step.branch === branch);
  return branchStep.fields;
}

export function commonFields() {
  return COMMON_STEPS.flatMap(fieldsForStep);
}

export function mergedSubmission(values, branch = values.accountType) {
  return {
    branch,
    fields: Object.fromEntries(
      [...commonFields(), ...branchFields(branch)]
        .map((field) => [field, values[field]])
    ),
    agreed: values.agree === true
  };
}
