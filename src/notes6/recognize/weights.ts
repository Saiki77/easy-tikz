// The weights of the formula recognition network (src/notes6/recognize), written by hand: no number in this
// file comes from an optimiser. A copy of the frozen design (hover-ml, designed-r1) without its hybrid part.
// Data only: net.ts turns it into matrices.
//
// A unit is [name, bias, 'input weight input weight ...']. Inputs are features (features.ts) or earlier units.
// Every unit computes clip01(bias + sum of weight * input). With 0/1 inputs this gives the three patterns used here:
//   OR   bias 0,        weights +1                      "one of these is present"
//   AND  bias -(n-1),   weights +1 on n inputs          "all of these are present"
//   veto weight -2 on an input                          "... and this is absent" (cancels a full AND)
// The output layer is linear: score(label) = bias + sum of weight * card unit; the label with the largest score wins.
// none has the constant score 0.5: a card needs clear evidence (one full card unit) to win. The output weights
// above 1 order the cards where two can fire together (the more specific card has the larger weight).
import type { NetSpec } from './net';

export const SPEC: NetSpec = {
    units: [
        // ---- layer 1: what kind of notation is this? (ORs and small ANDs over the features)
        ['V_ops', 0, 'op_int 1 op_lim 1 op_prod 1 op_ddx 1 op_nabla 1 op_bigO 1 op_mod 1 op_logic 1 hasCases 1 hasLarrow 1 hasEquiv 1 hasSim 1 hasSub 1 hasOtherRel 1'],
        ['V_prob', 0, 'op_prob 1 op_binom 1 hasFact 1 hasMid 1'],
        ['V_mat', 0, 'mat1 1 mat2p 1 vmat 1 detAny 1'],
        ['V_set', 0, 'setB 1 setList 1 setLevel 1 hasBB 1 hasSetOps 1'],
        ['ABSFN', -1, 'hasAbs 1 hasFn 1'],
        ['V_data', 0, 'hasVec 1 hasTop 1 hasNorm 1 hasAngle 1 hasArr 1 hasLayer 1 idxSubs 1 hasDots 1 has_x3p 1 capMul 1 usesDefMatrix 1'],
        ['V_unk', 0, 'unkCall 1 unkCallMarked 1 primeBody 1 selfRef 1 defCall 1'],
        ['V_value', 0, 'lastNumeric 1 firstBodyNumeric 1 bodyTuple 1 hasPm 1 hcArgNum 1 hcArgMarked 1 hcArgExpr 1 ha_star 1'],
        ['V_cplx', 0, 'hasImag 1 hasReIm 1'],
        ['V_struct', 0, 'mat1 1 mat2p 1 vmat 1 setB 1 setList 1 setLevel 1 iv 1 list3 1 hasBB 1 hasSetOps 1 detAny 1 epiOp 1 hasColon 1 hasText 1 textOnly 1 numeric 1 lone 1 loneCall 1 empty 1'],
        ['C_nonlin', 0, 'hasPow 1 hasFn 1 hasFrac 1 hasAbs 1 fnMaxMin 1 hasFloor 1 knownCall 1'],
        ['XY', -1, 'has_x 1 has_y 1'],
        ['X12', -1, 'has_x1 1 has_x2 1'],
        ['XVAR', 0, 'has_x 1 has_xi 1'],
        ['HV_real', 0, 'hcArg_x 1 hcArg_t 1 hcArg_other 1 hcArg_omega 1 hcArg_ang 1'],
        ['JWABS', -1, 'hcJw 1 hcAbs 1'],
        ['ZREAL', 0, 'ctxML 1 hn_sigma 1 hn_word 1 fnMaxMin 1 knownCall 1'],
        ['SREAL', 0, 'ctxProb 1 hcSubCap 1'],
        ['INEQ', 0, 'ineq1 1 ineq2 1 ineq3p 1'],
        ['EQANY', 0, 'eq1 1 eq2p 1'],
        ['NAMEHEAD', 0, 'ha_fname 1 hname 1 ha_cap 1'],
        ['BODY1V', 0, 'bodyOnlyX 1 bodyOnlyQ 1'],
        ['SNAME', 0, 'ha_fname 1 ha_subst 1 ha_z 1 hname 1 ha_cap 1 ha_other 1'],
        ['PHEAD', 0, 'ha_r 1 hn_r 1 hexpr 1'],
        ['IDENT', -1, 'lhsFn 1 rhsFn 1'],
        ['RX12', -1, 'c_lhsX12 1 c_rhsNum 1'],
        ['RMIDY', -1, 'c_midY 1 c_endsHaveX 1'],
        ['CL', 0, 'c_lhsX 1 c_lhsT 1'],
        ['CR', 0, 'c_rhsNum 1 c_rhsAtom 1'],
        ['CTXSIG', 0, 'ctxSignal 1 ctxML 1'],
        ['IVENDS', 0, 'ivEndsNum 1 ivEndsAB 1'],
        ['IVFORM', 0, 'rel0 1 ivMemberAtom 1 ivNamed 1 ivApprox 1'],
        ['ZS_ok', -1, 'ivZeroSym 1 rel0 1 ctxPoint -2'],
        ['MEM_ok', 0, 'ivMemberAtom 1 ivEndsExpr -2'],
        ['CTX_ok', -1, 'ctxInterval 1 rel0 1 ivEndsExpr -2 ctxPoint -2'],
        ['EPI_a', -1, 'setLhsCall 1 setLe 1 setRhsCall -2'],
        ['EPI_b', -1, 'setRhsCall 1 setGe 1 setLhsCall -2'],
        ['JCOMB', -1, 'oneMinus2 1 callSame3 1'],
        ['MATOK', 0, 'matNumeric 1 matOneParam 1'],
        ['SEQSHAPE', 0, 'bodyOnly1 1 bodyHasInit 1'],
        ['RECF', 0, 'recNext 1 recPrev 1'],
        ['NLz', 0, 'hasPow 1 hasFn 1 hasFrac 1'],
        ['CTXS', 0, 'ctxSignal 1 ctxComplex 1'],

        // ---- layer 2: combinations of the layer-1 answers
        ['TWO', 0, 'XY 1 X12 1'],
        ['NL2', 0, 'C_nonlin 1 varProduct 1'],
        ['VETO_F', 0, 'V_ops 1 V_prob 1 V_data 1 V_unk 1 V_value 1 let6p 1 paramPair 1 op_sum 1 deco_bar 1 V_mat 1 V_set 1'],
        ['VETO_G', 0, 'V_ops 1 V_prob 1 V_data 1 V_unk 1 let7p 1 op_sum 1 hasStar 1 hasPm 1 deco_bar 1 V_mat 1 V_set 1'],
        ['VETO_D', 0, 'V_ops 1 V_prob 1 V_data 1 V_unk 1 V_value 1 let5 1 let6p 1 op_sum 1 V_set 1'],
        ['RV', 0, 'XY 1 X12 1 RX12 1 RMIDY 1'],
        ['IVR', 0, 'ZS_ok 1 MEM_ok 1 CTX_ok 1'],
        ['EPIP', 0, 'EPI_a 1 EPI_b 1'],
        ['JP', 0, 'JCOMB 1 jensenE 1 jensenSum 1'],

        // ---- layer 3: one unit per way a card can be earned
        // function
        ['F_head', -1, 'HV_real 1 JWABS 1 bodyHasArg 1 VETO_F -2 hasImag -2 INEQ -2 laterEval -2'],
        ['F_headz', -2, 'hcArg_z 1 bodyHasArg 1 ZREAL 1 VETO_F -2'],
        ['F_heads', -2, 'hcArg_s 1 bodyHasArg 1 SREAL 1 VETO_F -2'],
        ['F_y', -1, 'ha_y 1 has_x 1 VETO_F -2 INEQ -2 hasImag -2 has_y -2 ha_prime -2'],
        ['F_name', -1, 'NAMEHEAD 1 BODY1V 1 VETO_F -2 INEQ -2'],
        ['F_seq', -2, 'ha_subIdx 1 bodyHasIdx 1 SEQSHAPE 1 VETO_F -2 recPrev -2 recOtherIdx -2 ha_hat -2 INEQ -2 V_cplx -2 ctxProb -2'],
        ['F_xsub', -2, 'ha_xsub 2 has_x1 1 has_x2 1 VETO_F -2 eq2p -2 INEQ -2'],
        ['F_bare', -2, 'bare 1 XVAR 1 C_nonlin 1 VETO_F -2 V_struct -2 V_cplx -2 has_y -2 has_x1 -2 has_x2 -2 has_z -2 hasStar -2 has_k -2'],
        ['F_bare_t', -2, 'bare 1 has_t 1 C_nonlin 1 VETO_F -2 V_struct -2 V_cplx -2 has_x -2 has_y -2 has_z -2 has_s -2 has_n -2'],
        ['F_bare_z', -3, 'bare 1 has_z 1 C_nonlin 1 ZREAL 1 VETO_F -2 V_struct -2 V_cplx -2 has_x -2 has_y -2'],
        ['F_bare_n', -3, 'bare 1 has_n 1 C_nonlin 1 ctxSeq 1 VETO_F -2 V_struct -2 V_cplx -2 has_x -2 has_y -2'],
        // surface
        ['S_head', -1, 'hc2 1 bodyHasBothArgs 1 VETO_G -2 V_value -2 INEQ -2'],
        ['S_hx', -2, 'hcArg_x 1 X12 1 NL2 1 VETO_G -2 V_value -2 INEQ -2 has_x -2'],
        ['S_name', -2, 'SNAME 1 TWO 1 NL2 1 VETO_G -2 V_value -2 eq2p -2 INEQ -2 V_cplx -2 has_z -2'],
        ['S_z', -1, 'ha_z 1 TWO 1 VETO_G -2 V_value -2 eq2p -2 INEQ -2 V_cplx -2'],
        ['S_bare', -2, 'bare 1 TWO 1 NL2 1 VETO_G -2 V_struct -2 V_cplx -2 has_z -2'],
        // polar
        ['P_polar', -1, 'polarR 1 PHEAD 1 has_x -2 has_y -2 V_cplx -2 V_ops -2 INEQ -2'],
        // implicit
        ['I_expr', -2, 'hexpr 1 eq1 1 TWO 1 VETO_G -2 V_cplx -2 IDENT -2 INEQ -2 hasNe -2 has_z -2 V_struct -2 hasIn -2 hasTo -2'],
        ['I_x', -2, 'ha_x 1 has_y 1 eq1 1 VETO_G -2 V_cplx -2 INEQ -2 has_z -2 V_struct -2 has_x -2'],
        // region
        ['RG', -1, 'INEQ 1 RV 1 EQANY -2 VETO_G -2 V_cplx -2 hasNe -2 hasIn -2 has_z -2'],
        // condition
        ['C_one', -2, 'ineq1 1 CL 1 c_rhsNum 1 V_data -2 V_ops -2 V_prob -2 ABSFN -2 anyVec -2 anyLogic -2 ctxVec -2'],
        ['C_abs', -2, 'c_lhsAbs 1 c_less 1 CR 1 c_lhsHasZL -2 V_data -2 V_ops -2 V_prob -2 hasStar -2 deco_bar -2 deco_hat -2 anyLogic -2'],
        ['C_call', -2, 'c_lhsCallX 1 c_rhsNum 1 ineq1 1'],
        ['C_two', -3, 'ineq2 1 c_midAtom 1 c_endsNum 1 c_less 1 c_midIdx -2 V_ops -2'],
        ['C_sig', -2, 'c_lhsOmegaZ 1 c_rhsNum 1 CTXSIG 1'],
        // interval
        ['IV_sq', -3, 'iv 1 ivSquare 1 IVENDS 1 IVFORM 1 hasArr -2 V_prob -2 anyPm -2'],
        ['IV_rd', -2, 'iv 1 ivRound 1 IVR 1 V_prob -2 anyPm -2'],
        // set and epigraph
        ['EPI_op', 0, 'epiOp 1 hasText -2'],
        ['SET', 0, 'setB 1 setLevel 1 hasSetOps -2 op_logic -2 setBadElem -2 hasTop -2 capMul -2 op_nabla -2 hasText -2 hasDots -2 callNonX -2 hasReIm -2 hasArr -2 op_prob -2'],
        ['EPI', -2, 'setB 1 setTuple 1 EPIP 1'],
        // map
        ['MAP', -1, 'mapForm 1 mapCodR 1 mapDomAbstract -2 mapHasC -2 anyMapsto -2 mapCodPow -2'],
        // jensen
        ['JEN', -1, 'ineq1 1 JP 1 hasStar -2 hasIn -2 EQANY -2'],
        // matrix, det, product, eigen
        ['MAT', -1, 'matSq 1 MATOK 1 matStateVar -2 matDots -2 detLead -2 matAdjVec -2 hc -2 vmat -2 hasCases -2 V_ops -2'],
        ['DET', 0, 'detLone 1 detMat 1 vmatNumeric 1'],
        ['PROD', 0, 'prodAv 1 prodVec 1 matAdjVec 1'],
        ['EIG', 0, 'eig1 1 eig2 1'],
        // recurrence
        ['REC', 0, 'RECF 1 recTwoStep -2 recOtherIdx -2 V_unk -2 V_ops -2 V_prob -2 hasVec -2 hasTop -2 hasArr -2 ha_hat -2 op_sum -2 INEQ -2'],
        // sum
        ['SUM', -1, 'sumLead 1 sumBounds 1 sumData -2 V_unk -2 op_lim -2 op_int -2 op_prob -2 op_binom -2 hasMid -2 hasVec -2 hasTop -2 hasArr -2 deco_bar -2 deco_hat -2 INEQ -2 hasLayer -2'],
        // domain
        ['D_headz', -2, 'hcArg_z 1 bodyHasArg 1 NLz 1 ZREAL -2 VETO_D -2'],
        ['D_heads', -1, 'hcArg_s 1 bodyHasArg 1 SREAL -2 VETO_D -2 let4 -2'],
        ['D_bare_z', -2, 'bare 1 has_z 1 NLz 1 ZREAL -2 ctxProb -2 has_x -2 has_y -2 VETO_D -2 V_struct -2 hasAbs -2 hasReIm -2 deco_bar -2'],
        ['D_bare_s', -3, 'bare 1 has_s 1 hasFrac 1 CTXS 1 has_n -2 has_x -2 has_t -2 VETO_D -2 V_struct -2'],
    ],
    // ---- output layer (linear)
    out: [
        ['none', 0.5, 'afterWord 1 genericProgram 1'],
        ['function', 0, 'F_head 1 F_headz 1 F_heads 1 F_y 1 F_name 1 F_seq 1 F_xsub 1 F_bare 1 F_bare_t 1 F_bare_z 1 F_bare_n 1'],
        ['surface', 0, 'S_head 1.1 S_hx 1.1 S_name 1.1 S_z 1.1 S_bare 1.1'],
        ['polar', 0, 'P_polar 1.3'],
        ['implicit', 0, 'I_expr 1 I_x 1'],
        ['region', 0, 'RG 1.2'],
        ['condition', 0, 'C_one 1 C_abs 1 C_call 1 C_two 1 C_sig 1'],
        ['interval', 0, 'IV_sq 1 IV_rd 1'],
        ['set', 0, 'SET 1'],
        ['epigraph', 0, 'EPI 1.5 EPI_op 1.5'],
        ['map', 0, 'MAP 1'],
        ['jensen', 0, 'JEN 1.4'],
        ['matrix', 0, 'MAT 1'],
        ['det', 0, 'DET 1.5'],
        ['product', 0, 'PROD 1.4'],
        ['eigen', 0, 'EIG 1.5'],
        ['recurrence', 0, 'REC 1.3'],
        ['sum', 0, 'SUM 1.3'],
        ['domain', 0, 'D_headz 1 D_heads 1 D_bare_z 1 D_bare_s 1'],
    ],
};

