OPENQASM 2.0;
include "qelib1.inc";

qreg q[5];
creg c[5];

h q[0];
cx q[0], q[1];
cx q[1], q[0];
cx q[0], q[1];
