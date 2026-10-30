import type { Dictionary } from '../en/index.ts';
import type { invite as reference } from '../en/invite.ts';

export const invite: Pick<Dictionary, keyof typeof reference> = {
    'invite.join.tab': '加入 Baziche',
    'invite.join.title': '{name} 邀请你加入 Baziche',
    'invite.join.someone': '一位朋友邀请你加入 Baziche',
    'invite.join.lead': '和朋友一起玩飞行棋、霍克姆、西洋双陆棋、扑克和国际象棋，实时或回合制。',
    'invite.join.how': '连接钱包，签名时即创建你的账户。',
    'invite.join.member': '你已经有账户了',
    'invite.join.memberLead': '邀请链接用于新账户，而你的账户已经在这里了。',
    'invite.join.open': '打开 Baziche',
    'invite.join.gone': '这个邀请链接已失效',
    'invite.join.goneLead': '发送者可能已经生成了新链接。你仍然可以加入。'
};
